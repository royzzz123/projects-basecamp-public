# project-chatbot

LibreChat + MongoDB MCP server for querying SEBI complaint data via GPT-4o.

## Stack

| Component | What it does |
|-----------|-------------|
| **LibreChat** | Full-featured chat UI with MCP tool support |
| **@mongodb-js/mongodb-mcp-server** | Gives the LLM read-only access to SEBI's MongoDB |
| **OnFinance LLM Gateway** | Port-forwarded `llm-gateway` svc (`onfinance-llm` ns) on `localhost:4000` — OpenAI-compatible |
| **MongoDB 7** | LibreChat's internal store (separate from SEBI's MongoDB) |

## Prerequisites

Make sure these two port-forwards are active (via `portforward-services.sh`):
- **LLM Gateway** → `localhost:4000`
- **MongoDB** → `localhost:27017`

## Quick start

### 1. Copy and fill env vars

```bash
cp .env.example .env
```

Generate secrets:

```bash
# JWT_SECRET and JWT_REFRESH_SECRET
openssl rand -hex 32

# CREDS_KEY (must be 32 hex chars)
openssl rand -hex 16

# CREDS_IV (must be 16 hex chars)
openssl rand -hex 8
```

Set `LLM_GATEWAY_KEY` (check LiteLLM config or ask infra team) and fill in `SEBI_MONGO_URI` with the password from `project-crud/.env`.

### 2. Start

```bash
docker compose up -d
```

LibreChat is available at **http://localhost:3000**.

Register an account on first run (registration is local — no external auth).

### 3. Verify the MCP tool is active

In LibreChat, open a conversation and click the wrench/tools icon. You should see **sebi-mongo** listed. The LLM can now run MongoDB queries against the SEBI database.

Example prompts:
- "How many complaints are in the Others sub-category?"
- "Show me the top 5 categories by complaint volume"
- "List complaints for entity 'XYZ Securities' from the last 30 days"

## Production notes

- The `SEBI_MONGO_URI` user should have **read-only** privileges at the DB level (not just the MCP's read-only flag).
- Replace `OPENAI_API_KEY` with a CDAC endpoint block in `librechat.yaml` once nemotron is confirmed stable.
- Lock `registration.allowedDomains` in `librechat.yaml` to `onfinance.in` before exposing externally.
- Run LibreChat behind your existing nginx/ingress with a `/chat` prefix if embedding in the SEBI portal.

## FE chat widget

The `ChatWidget` component in `project-fe/src/components/ChatWidget.tsx` renders a floating button in the bottom-right corner of the Dashboard, Complaint Explorer, and Entities pages. Set `VITE_CHAT_URL` in the FE `.env` to the LibreChat base URL:

```env
VITE_CHAT_URL=http://localhost:3000
```

The widget embeds LibreChat in an iframe — no extra auth is shared between the FE and LibreChat; users log into LibreChat separately.
# project-chatbot
