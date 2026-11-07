from __future__ import annotations

from fastapi import APIRouter

from graph.driver import graph_healthcheck

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/kg/health")
async def kg_health() -> dict[str, object]:
    """Liveness + Neo4j connectivity + node/relationship counts."""
    return graph_healthcheck()
