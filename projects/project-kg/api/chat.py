from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from chatbot.graph_qa import answer_question, summarize_complaint

router = APIRouter(prefix="/kg")


class ChatRequest(BaseModel):
    question: str


@router.post("/chat")
async def chat(req: ChatRequest) -> dict:
    """GraphRAG: natural-language question -> read-only Cypher -> grounded answer."""
    return await answer_question(req.question)


@router.get("/complaint/{complaint_id}/summary")
async def complaint_ai_summary(complaint_id: int) -> dict:
    """Short plain-English AI summary of the issue (generated once, cached on the node)."""
    return await summarize_complaint(complaint_id)
