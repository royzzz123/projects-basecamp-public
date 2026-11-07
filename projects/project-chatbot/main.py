"""
SEBI Chat Server — FastAPI + LangGraph + Motor

POST /chat                        { message: str, session_id: str | null }
  → SSE stream in OpenAI delta format, then data: [DONE]

GET  /sessions/{session_id}/messages → full message history for one session
GET  /health                      → {"status": "ok"}

Env vars (see config.py / .env.example):
  MONGO_URI                  required
  LLM_LLAMA_70B_URL          full chat/completions URL (default: localhost:4000/v1/chat/completions)
  LLM_LLAMA_70B_BEARER_TOKEN bearer token (default: no-key)
  LLM_LLAMA_70B_MODEL_ID     model id (default: bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0)
  LLM_HTTP_PROXY             outbound proxy for LLM (empty for local dev)
  LLM_VERIFY_SSL             false on SEBI VM (CDAC certs)
  APP_PORT                   default 3001
"""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage
from motor.motor_asyncio import AsyncIOMotorClient

from agent.graph import build_graph
from config import settings
from session.store import ensure_indexes, list_sessions, load_session, new_session_id, save_turn

# ── App state ──────────────────────────────────────────────────────────────

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client[settings.mongo_db]
    await ensure_indexes(db)
    _state["db"] = db
    _state["graph"] = build_graph(db)
    print(f"Connected to MongoDB: {settings.mongo_db}")
    print(f"LLM: {settings.llm_llama_70b_model_id} @ {settings.llm_base_url}")
    yield
    client.close()


app = FastAPI(title="SEBI Chat", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# ── SSE helper ─────────────────────────────────────────────────────────────

def _sse(content: str) -> str:
    return f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/sessions")
async def get_sessions():
    return await list_sessions(_state["db"])


@app.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str):
    messages = await load_session(_state["db"], session_id)
    return {"messages": [{"role": m["role"], "content": m["content"]} for m in messages]}


@app.post("/chat")
async def chat(request: Request):
    body = await request.json()
    user_message: str = body.get("message", "").strip()
    session_id: str = body.get("session_id") or new_session_id()

    if not user_message:
        return StreamingResponse(
            iter([_sse("Please enter a message."), "data: [DONE]\n\n"]),
            media_type="text/event-stream",
        )

    db = _state["db"]
    graph = _state["graph"]

    # Load history and build LangChain messages
    history = await load_session(db, session_id)
    lc_messages = []
    for m in history:
        if m["role"] == "user":
            lc_messages.append(HumanMessage(content=m["content"]))
        # assistant messages are reconstructed from history without tool calls —
        # keep them as plain AIMessage via a HumanMessage stand-in is wrong;
        # instead use langchain_core.messages.AIMessage
        elif m["role"] == "assistant":
            from langchain_core.messages import AIMessage
            lc_messages.append(AIMessage(content=m["content"]))

    lc_messages.append(HumanMessage(content=user_message))

    async def event_stream():
        full_reply = ""
        try:
            # stream_mode="messages" yields (chunk, metadata) for every message
            # emitted inside the graph — includes ToolMessage (raw DB results)
            # and AIMessageChunk (LLM tokens). Only forward text tokens from the
            # LLM's final answer; skip tool-call decisions and tool results.
            async for chunk, _ in graph.astream(
                {"messages": lc_messages},
                stream_mode="messages",
            ):
                if not isinstance(chunk, AIMessageChunk):
                    continue
                token = chunk.content
                if token and not chunk.tool_calls:
                    full_reply += token
                    yield _sse(token)
        except Exception as e:
            yield _sse(f"\n\nError: {e}")
        finally:
            if full_reply:
                asyncio.create_task(
                    save_turn(db, session_id, user_message, full_reply)
                )
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Session-Id": session_id,
        },
    )


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.app_port, reload=False)
