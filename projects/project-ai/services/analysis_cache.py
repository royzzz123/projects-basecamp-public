from __future__ import annotations

import logging
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from schemas.analysis import ComplaintAnalysisResponse, ComplaintSummaryResponse
from utils.crud_client import get_client

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


async def _fetch_cached(url: str, model: type[T]) -> T | None:
    try:
        resp = await get_client().get(url)
    except Exception:
        logger.exception("Cache GET failed for %s", url)
        return None

    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        logger.warning("Cache GET %s returned %s: %s", url, resp.status_code, resp.text[:300])
        return None

    try:
        return model.model_validate(resp.json())
    except ValidationError:
        logger.exception("Cache GET %s returned unparseable payload", url)
        return None


async def _store_cached(url: str, payload: BaseModel) -> None:
    body = payload.model_dump(mode="json", exclude={"complaint_id"})
    try:
        resp = await get_client().post(url, json=body)
    except Exception:
        logger.exception("Cache POST failed for %s", url)
        return

    if resp.status_code >= 400:
        logger.warning("Cache POST %s returned %s: %s", url, resp.status_code, resp.text[:300])


async def get_cached_workflow_analysis(complaint_id: int) -> ComplaintAnalysisResponse | None:
    return await _fetch_cached(
        f"/v1/complaint-workflow-analysis/{complaint_id}",
        ComplaintAnalysisResponse,
    )


async def store_workflow_analysis(
    complaint_id: int, response: ComplaintAnalysisResponse
) -> None:
    await _store_cached(f"/v1/complaint-workflow-analysis/{complaint_id}", response)


async def get_cached_complaint_summary(complaint_id: int) -> ComplaintSummaryResponse | None:
    return await _fetch_cached(
        f"/v1/complaint-summary/{complaint_id}",
        ComplaintSummaryResponse,
    )


async def store_complaint_summary(
    complaint_id: int, response: ComplaintSummaryResponse
) -> None:
    await _store_cached(f"/v1/complaint-summary/{complaint_id}", response)
