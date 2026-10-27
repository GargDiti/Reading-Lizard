import json
import logging
import hmac
import os
from pathlib import Path
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))
from services.url_detector import extract_url
from services.query_router import classify_query
from services.handlers import dispatch, prepare_website_learning, stream_dispatch
from services.groq_service import summarize_conversation
from services.vector_store import get_indexed_topics

app = FastAPI()
logger = logging.getLogger(__name__)

@app.get("/health")
def health():
    return {"status": "ok"}

def require_backend_token(authorization: str | None = Header(default=None)):
    expected = os.getenv("AI_SERVICE_TOKEN", "").strip()
    production = os.getenv("APP_ENV", "development").lower() == "production"
    if not expected:
        if production:
            raise HTTPException(status_code=503, detail="AI service authentication is not configured")
        return

    scheme, _, supplied = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Backend authentication required")

class QueryRequest(BaseModel):
    query: str
    source_text: str | None = None
    source_url: str | None = None
    selected_topic: str | None = None
    conversation_history: list[dict[str, str]] = Field(default_factory=list)
    conversation_summary: str = ""
    operation: str | None = None
    messages: list[dict[str, str]] = Field(default_factory=list)
    summary_target_tokens: int = Field(default=800, ge=100, le=2000)
    stream: bool = False


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_learning_response(request: QueryRequest):
    emitted_tokens = False
    try:
        url = extract_url(request.query) or request.source_url
        query_url = extract_url(request.query)
        classification = classify_query(
            request.query,
            url is not None,
            source_text=request.source_text,
        )

        if (
            query_url
            and request.selected_topic is None
            and classification["source"] == "website"
            and classification["action"] == "learn"
        ):
            prepared = prepare_website_learning(url)
            metadata = {
                "url": url,
                "topics": prepared["topics"],
                "awaiting_topic_selection": True,
                "allow_whole_website": True,
            }
            result = "Website indexed. Select a topic and ask your question."
            yield _sse("token", {"text": result})
            emitted_tokens = True
            yield _sse("done", {"result": result, **metadata})
            return

        metadata = {
            "url": url,
            "topics": [],
            "awaiting_topic_selection": False,
            "allow_whole_website": False,
        }
        parts = []
        for text in stream_dispatch(
            classification["source"],
            classification["action"],
            request.query,
            url,
            source_text=request.source_text,
            conversation_history=request.conversation_history[-10:],
            selected_topic=request.selected_topic,
            conversation_summary=request.conversation_summary,
        ):
            if text:
                parts.append(text)
                emitted_tokens = True
                yield _sse("token", {"text": text})

        result = "".join(parts).strip()
        if not result:
            raise ValueError("AI service returned an empty answer")
        yield _sse("done", {"result": result, **metadata})
    except GeneratorExit:
        raise
    except Exception as error:
        logger.exception("Streaming AI request failed")
        yield _sse("error", {
            "message": "The AI response ended before completion." if emitted_tokens
            else "The AI response could not be generated.",
            "incomplete": emitted_tokens,
        })


@app.post("/analyze-query", dependencies=[Depends(require_backend_token)])
def analyze_query(request: QueryRequest):
    if request.operation == "summarize":
        summary = summarize_conversation(
            request.conversation_summary,
            request.messages,
            request.summary_target_tokens,
        )
        return {"summary": summary}

    if request.operation == "get_indexed_topics":
        return {"topics": get_indexed_topics(request.source_url or "")}

    if request.stream:
        return StreamingResponse(
            _stream_learning_response(request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    url = extract_url(request.query) or request.source_url
    query_url = extract_url(request.query)
    has_url = url is not None

    classification = classify_query(
        request.query,
        has_url,
        source_text=request.source_text,
    )
    topics = []
    awaiting_topic_selection = False
    allow_whole_website = False
    if (
        query_url
        and request.selected_topic is None
        and classification["source"] == "website"
        and classification["action"] == "learn"
    ):
        prepared = prepare_website_learning(url)
        topics = prepared["topics"]
        awaiting_topic_selection = True
        allow_whole_website = True
        result = "Website indexed. Select a topic and ask your question."
    else:
        result = dispatch(
            classification["source"],
            classification["action"],
            request.query,
            url,
            source_text=request.source_text,
            conversation_history=request.conversation_history[-10:],
            selected_topic=request.selected_topic,
            conversation_summary=request.conversation_summary,
        )

    return {
        "query": request.query,
        "url": url,
        "has_url": has_url,
        "source": classification["source"],
        "action": classification["action"],
        "request_type": classification["request_type"],
        "topics": topics,
        "awaiting_topic_selection": awaiting_topic_selection,
        "allow_whole_website": allow_whole_website,
        "result": result,
    }
