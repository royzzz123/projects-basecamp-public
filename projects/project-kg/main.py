from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.chat import router as chat_router
from api.escalation import router as escalation_router
from api.health import router as health_router
from graph.driver import close_driver

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    close_driver()


app = FastAPI(
    title="SEBI SCORES — Auto-Escalation Knowledge Graph",
    version="0.1.0",
    lifespan=lifespan,
)

# Read-only internal dashboard API — permissive CORS for dev (UI is served from
# the same origin at /autoescalation in production).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _no_cache_ui(request, call_next):
    """Serve the /autoescalation UI with no-cache so edits are picked up on reload."""
    resp = await call_next(request)
    if request.url.path.startswith("/autoescalation"):
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

app.include_router(health_router)
app.include_router(escalation_router)
app.include_router(chat_router)

# Standalone dashboard UI — served by this service so the main project-fe
# app stays untouched. Reachable at /autoescalation.
_WEB_DIR = Path(__file__).parent / "web"
app.mount("/autoescalation", StaticFiles(directory=str(_WEB_DIR), html=True), name="autoescalation")
