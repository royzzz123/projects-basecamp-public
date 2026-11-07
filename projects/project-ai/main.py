from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.classify_sub_category import router as classify_sub_category_router
from api.complaint_analysis import router as complaint_router
from api.complaint_summary import router as complaint_summary_router
from utils.crud_client import close_client as close_crud_client
from utils.llm import close_client as close_llm_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_llm_client()
    await close_crud_client()


app = FastAPI(
    title="SEBI Complaint Workflow Analysis",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(classify_sub_category_router)
app.include_router(complaint_router)
app.include_router(complaint_summary_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
