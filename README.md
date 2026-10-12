# Reading Lizard

Reading Lizard is an AI-powered learning and research app. Learners can ask questions in a conversational interface, get beginner-friendly explanations, and explore a website by URL. Website content is scraped and indexed so follow-up answers can use relevant source material. Signed-in users can return to saved conversations and continue asking questions with recent conversation context.

## How It Works

The project runs as three services:

- **Frontend:** React and Vite provide the home page, account screens, and protected research workspace.
- **Backend:** Express handles authentication, saved conversations, MongoDB persistence, and requests to the AI service.
- **AI service:** FastAPI routes questions to the appropriate learning workflow. Groq generates explanations, Firecrawl extracts website content, and ChromaDB stores/retrieves indexed content. Redis is used for caching.

A typical request travels from the authenticated React chat to Express, which verifies conversation ownership and stores the user turn. Express requests an SSE response from FastAPI; the existing query router selects general tutoring or the Firecrawl/chunking/Chroma retrieval path, then the existing Groq model emits tokens. Express forwards those tokens to the browser and saves one assistant message when generation completes. Older conversation turns are summarized into MongoDB checkpoints while the newest turns remain in full.

## Features

- User registration and login with JWT authentication
- General, conversational learning answers
- Website scraping and indexing for source-informed answers
- Topic selection for website-based learning
- Saved conversations and recent message history
- Incremental AI responses with cancellation and incomplete-response status
- Rolling summaries with stable checkpoints and retained original messages
- Redis caching for supported AI and scraping workflows

## Project Structure

```text
learnloom/
|-- frontend/       React + Vite application
|-- backend/        Express API, authentication, and MongoDB models
|-- ai_services/    FastAPI application and AI/retrieval workflows
`-- README.md
```

## Requirements

- Node.js and npm
- Python 3.10 or later
- A MongoDB database
- API credentials for the AI features you use: Groq and Firecrawl
- Upstash Redis credentials for the Redis cache

## Configuration

Copy the provided `.env.example` files to local `.env` files and fill in your own values. Never commit real credentials. The repository ignores `.env` files.

Backend: `backend/src/.env` (copy `backend/src/.env.example`):

```dotenv
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/<database>
JWT_SECRET=replace-with-a-long-random-secret
AI_SERVICE_URL=http://127.0.0.1:8000
CONVERSATION_HISTORY_TOKEN_THRESHOLD=6000
CONVERSATION_SUMMARY_TARGET_TOKENS=800
CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT=12000
CONVERSATION_RECENT_MESSAGE_WINDOW=10
```

The complete backend timeout settings are in the example file. `AI_SERVICE_URL` must be configured; production must use the deployed AI service URL, not localhost.

AI service: `ai_services/.env` (copy `ai_services/.env.example`):

```dotenv
GROQ_API_KEY=your-groq-api-key
FIRECRAWL_API_KEY=replace-with-your-firecrawl-api-key
UPSTASH_REDIS_REST_URL=https://<your-database>.upstash.io
UPSTASH_REDIS_REST_TOKEN=replace-with-your-upstash-token
MODEL_CONTEXT_TOKEN_LIMIT=16384
AI_RESPONSE_TOKEN_BUDGET=2048
CONVERSATION_PROMPT_TOKEN_BUDGET=6000
RAG_CONTEXT_TOKEN_BUDGET=4000
```

The context ceiling is configurable and intentionally conservative; confirm the current limit for the Groq model/account before increasing it. Prompt budgeting also reserves space for system instructions and the answer.

Frontend: `frontend/.env` (copy `frontend/.env.example`):

```dotenv
VITE_API_URL=http://localhost:3000
```

For a deployed frontend, set `VITE_API_URL` to the public backend URL when building the frontend. Vite embeds `VITE_` variables in the client build, so they are not server-side secrets.

## Run Locally

Start MongoDB and make sure the environment files above are configured. Run each service in a separate terminal from the repository root.

**1. AI service**

```powershell
cd ai_services
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The AI service exposes `GET /health` and `POST /analyze-query`. The same POST endpoint accepts normal JSON, streaming requests, and summary operations.

**2. Backend API**

```powershell
cd backend
npm install
npm run dev
```

The backend exposes `GET /api/health` and `GET /api/health/ready`. The ready check reports whether MongoDB is connected.

**3. Frontend**

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite in the terminal.

## Deployment

`render.yaml` defines Render web services for the backend and AI API. Review the service names before syncing the Blueprint so it associates with your existing Render services rather than creating unintended duplicates. Add secret values in Render's environment settings; do not put credentials in `render.yaml`.

- Set backend `MONGODB_URI`, `JWT_SECRET`, and `AI_SERVICE_URL` to the public AI API URL.
- Set the AI service's `GROQ_API_KEY`, `FIRECRAWL_API_KEY`, and Upstash Redis credentials.
- If the frontend stays on Vercel, set its `VITE_API_URL` to the public backend URL. Vercel serves Functions on demand; it does not use an app-selected `PORT` for FastAPI.
- Ensure all proxy layers pass `text/event-stream` without buffering. Express and FastAPI send `Cache-Control: no-transform` and `X-Accel-Buffering: no` for streaming responses.
- Check AI `GET /health`, backend `GET /api/health`, and Mongo readiness via `GET /api/health/ready`.

Render supplies `PORT`; its FastAPI start command binds to `0.0.0.0:$PORT`.

## Streaming API

The authenticated route remains `POST /api/conversations/:id/messages`. Send the existing message fields plus `stream: true` and a unique `requestId`:

```json
{"message":"Explain event loops","stream":true,"requestId":"a-unique-request-id"}
```

The authenticated response is `text/event-stream`; each event's `data` is JSON. `token` carries `{ "text": "..." }`, `done` carries the final saved message and website metadata, and `error` carries `{ "message": "...", "incomplete": true|false }`. The browser abort signal cancels the fetch and upstream request. A retry must use a new `requestId`; a duplicate ID replays a completed response or is rejected while the prior response is unfinished.

FastAPI keeps `POST /analyze-query` for existing JSON callers. Add `"stream": true` for SSE; send `"operation": "summarize"` with `conversation_summary`, `messages`, and `summary_target_tokens` for a summary operation.

## Rolling Memory

Backend settings control compaction and the retained full-message window: `CONVERSATION_HISTORY_TOKEN_THRESHOLD` (default 6000 estimated tokens), `CONVERSATION_SUMMARY_TARGET_TOKENS` (default 800), `CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT` (default 12000 per summary batch), and `CONVERSATION_RECENT_MESSAGE_WINDOW` (default 10 messages). Large backlogs are summarized in bounded chronological batches; the checkpoint advances only through turns included in each successful summary. The AI service separately budgets the rolling summary/recent turns, retrieved RAG content, current question, and answer against `MODEL_CONTEXT_TOKEN_LIMIT`. Token counts use a configurable conservative character estimate (`TOKEN_ESTIMATE_CHARS_PER_TOKEN=3`), not a tokenizer-specific exact count.

The conversation document stores its rolling summary, summary checkpoint message ID, update timestamp, and version. Summary updates use compare-and-swap; the source messages are retained and are never mixed with or deleted from ChromaDB.

## Tests

Run the backend tests from the repository root:

```powershell
npm --prefix backend test
```

Run the focused AI service tests from the repository root using the project virtual environment:

```powershell
Push-Location ai_services
..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_conversation_history.py"
Pop-Location
```

The other `test_*.py` scripts include interactive or live Firecrawl/Groq calls; inspect those before running them as a batch.

## Notes

- User accounts, conversations, and messages are stored in MongoDB.
- ChromaDB data is persisted under `ai_services/chroma_data/`; configure durable storage for this directory if website indexes must survive AI service restarts or redeployments.
- Keep API keys and database credentials out of source control and frontend environment variables.
