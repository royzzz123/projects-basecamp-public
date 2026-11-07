from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from schemas.analysis import ComplaintSummaryResponse
from services.analysis_cache import (
    get_cached_complaint_summary,
    store_complaint_summary,
)
from services.complaint_client import (
    ComplaintFetchError,
    ComplaintNotFound,
    fetch_complaint,
)
from services.complaint_summarizer import summarize
from utils.log_streaming import stream_with_logs

logger = logging.getLogger(__name__)

router = APIRouter()


async def _run(complaint_id: int) -> ComplaintSummaryResponse:
    cached = await get_cached_complaint_summary(complaint_id)
    if cached is not None:
        logger.info("Returning cached complaint summary for %s", complaint_id)
        return cached

    try:
        complaint = await fetch_complaint(complaint_id)
    except ComplaintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ComplaintFetchError as e:
        raise HTTPException(status_code=502, detail=str(e))

    summary = await summarize(complaint)

    response = ComplaintSummaryResponse(
        complaint_id=complaint.complaint_id,
        complaint_code=complaint.complaint_code,
        category=complaint.category.name if complaint.category else None,
        sub_category=complaint.sub_category,
        entity_name=complaint.entity.name if complaint.entity else None,
        filed_at=complaint.filed_date,
        complaint_details=complaint.complaint_details,
        summary=summary,
    )

    await store_complaint_summary(complaint_id, response)
    return response


@router.get(
    "/complaint-summary/{complaint_id}",
    response_model=ComplaintSummaryResponse,
)
async def complaint_summary(
    complaint_id: int,
    stream: bool = Query(False, description="Stream NDJSON log + result events"),
):
    if stream:
        return StreamingResponse(
            stream_with_logs(_run(complaint_id)),
            media_type="application/x-ndjson",
        )
    return await _run(complaint_id)
