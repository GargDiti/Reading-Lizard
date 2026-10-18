import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from main import QueryRequest, analyze_query, require_backend_token
from services.groq_service import (
    _format_retrieved_chunks,
    _prompt_budgets,
    answer_from_context,
    explain_general_query,
    stream_general_query,
    summarize_conversation,
)
from services.handlers import handle_website_learn
from services.query_router import Action, RequestType, Source


class ConversationHistoryTests(unittest.TestCase):
    def setUp(self):
        self.history = [
            {"role": "user", "content": "What is Node.js?"},
            {"role": "assistant", "content": "Node.js is a JavaScript runtime."},
        ]

    @staticmethod
    def _groq_response(answer="Contextual answer"):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=answer))]
        )

    def test_internal_ai_endpoint_requires_matching_backend_token_when_configured(self):
        with patch.dict("os.environ", {"AI_SERVICE_TOKEN": "shared-test-token", "APP_ENV": "production"}):
            with self.assertRaises(Exception) as missing:
                require_backend_token(None)
            self.assertEqual(getattr(missing.exception, "status_code", None), 401)
            with self.assertRaises(Exception) as incorrect:
                require_backend_token("Bearer wrong-token")
            self.assertEqual(getattr(incorrect.exception, "status_code", None), 401)
            self.assertIsNone(require_backend_token("Bearer shared-test-token"))

    def test_production_ai_endpoint_fails_closed_without_internal_token(self):
        with patch.dict("os.environ", {"APP_ENV": "production"}, clear=True):
            with self.assertRaises(Exception) as missing_configuration:
                require_backend_token("Bearer anything")
            self.assertEqual(getattr(missing_configuration.exception, "status_code", None), 503)

    def test_general_groq_prompt_receives_conversation_history(self):
        with patch(
            "services.groq_service.client.chat.completions.create",
            return_value=self._groq_response(),
        ) as create:
            answer = explain_general_query("Why is it fast?", self.history)

        self.assertEqual(answer, "Contextual answer")
        prompt = create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("Previous learning context:", prompt)
        self.assertIn("USER: What is Node.js?", prompt)
        self.assertIn("ASSISTANT: Node.js is a JavaScript runtime.", prompt)
        self.assertIn("Why is it fast?", prompt)

    def test_rag_groq_prompt_separates_history_context_and_current_question(self):
        chunks = [{
            "section_title": "Introduction",
            "text": "Node.js uses an event-driven, non-blocking architecture.",
        }]
        with patch(
            "services.groq_service.client.chat.completions.create",
            return_value=self._groq_response(),
        ) as create:
            answer = answer_from_context("Why is it fast?", chunks, self.history)

        self.assertEqual(answer, "Contextual answer")
        prompt = create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("Conversation memory:", prompt)
        self.assertIn("Retrieved website context and source metadata:", prompt)
        self.assertIn("Current question:", prompt)
        self.assertIn("USER: What is Node.js?", prompt)
        self.assertIn("event-driven, non-blocking architecture", prompt)
        self.assertIn("Why is it fast?", prompt)

    def test_follow_up_source_url_and_history_are_forwarded_to_existing_dispatch(self):
        source_url = "https://nodejs.org/learn/getting-started/introduction-to-nodejs"
        request = QueryRequest(
            query="Why is it fast?",
            source_url=source_url,
            conversation_history=self.history,
        )
        classification = {
            "source": Source.WEBSITE,
            "action": Action.LEARN,
            "request_type": RequestType.WEBSITE_LEARNING,
        }
        with (
            patch("main.classify_query", return_value=classification),
            patch("main.dispatch", return_value="Contextual answer") as dispatch,
        ):
            result = analyze_query(request)

        self.assertEqual(result["url"], source_url)
        self.assertTrue(result["has_url"])
        self.assertEqual(result["result"], "Contextual answer")
        dispatch.assert_called_once_with(
            Source.WEBSITE,
            Action.LEARN,
            "Why is it fast?",
            source_url,
            source_text=None,
            conversation_history=self.history,
            selected_topic=None,
            conversation_summary="",
        )

    def test_initial_website_request_returns_topics_for_selection(self):
        source_url = "https://docs.example.org/guide"
        request = QueryRequest(query=f"Learn from {source_url}")
        classification = {
            "source": Source.WEBSITE,
            "action": Action.LEARN,
            "request_type": RequestType.WEBSITE_LEARNING,
        }
        topics = [{"level": 1, "title": "Getting Started"}]
        with (
            patch("main.classify_query", return_value=classification),
            patch(
                "main.prepare_website_learning",
                return_value={"topics": topics, "indexed_chunks": 2},
            ) as prepare,
            patch("main.dispatch") as dispatch,
        ):
            result = analyze_query(request)

        prepare.assert_called_once_with(source_url)
        dispatch.assert_not_called()
        self.assertEqual(result["topics"], topics)
        self.assertTrue(result["awaiting_topic_selection"])
        self.assertTrue(result["allow_whole_website"])

    def test_selected_topic_is_used_for_website_retrieval(self):
        url = "https://docs.example.org/guide"
        retrieved = [{"text": "The event loop schedules asynchronous work."}]
        with (
            patch("services.handlers.scrape_page", return_value={"markdown": "# Introduction\nDetails"}),
            patch("services.handlers.extract_topics", return_value=[{"level": 1, "title": "Introduction"}]),
            patch("services.handlers.extract_section", return_value="Details"),
            patch("services.handlers.chunk_markdown", return_value=[{"chunk_id": 0, "text": "Details"}]),
            patch("services.handlers.index_chunks", return_value=1),
            patch("services.handlers.search_chunks", return_value=retrieved) as search,
            patch("services.handlers.answer_from_context", return_value="Answer") as answer,
        ):
            result = handle_website_learn(
                "Why is it fast?",
                url,
                self.history,
                "Introduction",
            )

        self.assertEqual(result, "Answer")
        search.assert_called_once_with(
            "Why is it fast?\nIntroduction",
            url,
            top_k=4,
        )
        answer.assert_called_once_with("Why is it fast?", retrieved, self.history)

    def test_fastapi_sse_emits_incremental_tokens_then_completion(self):
        classification = {
            "source": Source.GENERAL,
            "action": Action.LEARN,
            "request_type": RequestType.GENERAL_LEARNING,
        }

        async def read_events(response):
            return [chunk async for chunk in response.body_iterator]

        with (
            patch("main.classify_query", return_value=classification),
            patch("main.stream_dispatch", return_value=iter(["first ", "second"])),
        ):
            response = analyze_query(QueryRequest(query="Teach this", stream=True))
            events = asyncio.run(read_events(response))

        self.assertEqual(response.media_type, "text/event-stream")
        self.assertEqual(response.headers["x-accel-buffering"], "no")
        combined = "".join(events)
        self.assertIn('event: token\ndata: {"text": "first "}', combined)
        self.assertIn('event: token\ndata: {"text": "second"}', combined)
        self.assertIn('event: done\ndata: {"result": "first second"', combined)

    def test_fastapi_sse_encodes_newlines_and_unicode_as_json(self):
        classification = {
            "source": Source.GENERAL,
            "action": Action.LEARN,
            "request_type": RequestType.GENERAL_LEARNING,
        }

        async def read_events(response):
            return [chunk async for chunk in response.body_iterator]

        with (
            patch("main.classify_query", return_value=classification),
            patch("main.stream_dispatch", return_value=iter(["line one\n\u03bb"])),
        ):
            response = analyze_query(QueryRequest(query="Teach this", stream=True))
            events = asyncio.run(read_events(response))

        self.assertIn('data: {"text": "line one\\n\u03bb"}', "".join(events))

    def test_fastapi_sse_reports_incomplete_generation_as_error_event(self):
        classification = {
            "source": Source.GENERAL,
            "action": Action.LEARN,
            "request_type": RequestType.GENERAL_LEARNING,
        }

        def broken_stream(*_args, **_kwargs):
            yield "partial"
            raise RuntimeError("provider detail should not leak after tokens")

        async def read_events(response):
            return [chunk async for chunk in response.body_iterator]

        with (
            patch("main.classify_query", return_value=classification),
            patch("main.stream_dispatch", side_effect=broken_stream),
        ):
            response = analyze_query(QueryRequest(query="Teach this", stream=True))
            events = asyncio.run(read_events(response))

        combined = "".join(events)
        self.assertIn("event: token", combined)
        self.assertIn('event: error\ndata: {"message": "The AI response ended before completion.", "incomplete": true}', combined)

    def test_fastapi_summary_operation_uses_the_existing_groq_summary_function(self):
        messages = [{"role": "user", "content": "I am learning Node.js"}]
        with patch("main.summarize_conversation", return_value="Learning Node.js") as summarize:
            result = analyze_query(QueryRequest(
                query="Update summary",
                operation="summarize",
                conversation_summary="Existing summary",
                messages=messages,
                summary_target_tokens=250,
            ))

        self.assertEqual(result, {"summary": "Learning Node.js"})
        summarize.assert_called_once_with("Existing summary", messages, 250)

    def test_groq_streaming_uses_the_existing_model_and_requests_stream_mode(self):
        chunks = [
            SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="Hello "))]),
            SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="there"))]),
        ]
        with patch("services.groq_service.client.chat.completions.create", return_value=iter(chunks)) as create:
            result = list(stream_general_query("Teach me", self.history))

        self.assertEqual(result, ["Hello ", "there"])
        self.assertEqual(create.call_args.kwargs["model"], "qwen/qwen3.8-27b")
        self.assertTrue(create.call_args.kwargs["stream"])

    def test_prompt_budgets_reserve_response_and_cap_total_context(self):
        with patch.dict("os.environ", {
            "MODEL_CONTEXT_TOKEN_LIMIT": "10000",
            "AI_RESPONSE_TOKEN_BUDGET": "1000",
            "AI_SYSTEM_TOKEN_RESERVE": "1000",
            "CURRENT_QUESTION_TOKEN_BUDGET": "1500",
            "CONVERSATION_PROMPT_TOKEN_BUDGET": "4000",
            "RAG_CONTEXT_TOKEN_BUDGET": "4000",
        }):
            question, history, rag, response = _prompt_budgets()

        self.assertLessEqual(question + history + rag + response + 1000, 10000)

    def test_rag_prompt_keeps_url_section_and_chunk_citation_metadata(self):
        formatted = _format_retrieved_chunks([{
            "text": "Node uses a non-blocking event loop.",
            "source_url": "https://nodejs.org/guide",
            "section_title": "Event loop",
            "chunk_id": 7,
            "similarity": 0.82,
        }], 500)

        self.assertIn("https://nodejs.org/guide", formatted)
        self.assertIn("Event loop", formatted)
        self.assertIn("chunk 7", formatted)

    def test_summary_prompt_requests_learning_goals_misunderstandings_and_open_questions(self):
        response = self._groq_response("Updated memory")
        messages = [{"role": "assistant", "content": "The learner asked a follow-up."}]
        with patch("services.groq_service.client.chat.completions.create", return_value=response) as create:
            result = summarize_conversation("Existing context", messages, 200)

        self.assertEqual(result, "Updated memory")
        prompt = create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("misunderstandings", prompt)
        self.assertIn("unresolved questions", prompt)
        self.assertEqual(create.call_args.kwargs["max_tokens"], 200)

    def test_summary_rejects_oversized_batch_instead_of_silently_dropping_turns(self):
        with patch.dict("os.environ", {"CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT": "2"}):
            with self.assertRaisesRegex(ValueError, "exceeds its configured input budget"):
                summarize_conversation("", [{"role": "user", "content": "A longer turn"}], 100)


if __name__ == "__main__":
    unittest.main()
