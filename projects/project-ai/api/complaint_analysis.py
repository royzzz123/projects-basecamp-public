from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from schemas.analysis import ComplaintAnalysisResponse
from services.analysis_cache import (
    get_cached_workflow_analysis,
    store_workflow_analysis,
)
from services.complaint_client import (
    ComplaintFetchError,
    ComplaintNotFound,
    fetch_complaint,
)
from services.timeline_enricher import build_doc_summary_map, enrich_timeline
from services.workflow_analyzer import analyze
from utils.log_streaming import stream_with_logs

logger = logging.getLogger(__name__)

router = APIRouter()


async def _run(complaint_id: int) -> ComplaintAnalysisResponse:
    cached = await get_cached_workflow_analysis(complaint_id)
    if cached is not None:
        logger.info("Returning cached workflow analysis for %s", complaint_id)
        return cached

    try:
        complaint = await fetch_complaint(complaint_id)
    except ComplaintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ComplaintFetchError as e:
        raise HTTPException(status_code=502, detail=str(e))

    summaries_by_uuid = await build_doc_summary_map(complaint)
    enriched = enrich_timeline(complaint.activity_timeline, summaries_by_uuid)
    workflow_analysis = await analyze(complaint, enriched)

    response = ComplaintAnalysisResponse(
        complaint_id=complaint.complaint_id,
        complaint_code=complaint.complaint_code,
        category=complaint.category.name if complaint.category else None,
        sub_category=complaint.sub_category,
        entity_name=complaint.entity.name if complaint.entity else None,
        filed_at=complaint.filed_date,
        closed_at=complaint.closed_at,
        time_taken_label=complaint.time_taken_label,
        current_status=complaint.current_status,
        enriched_timeline=enriched,
        workflow_analysis=workflow_analysis,
    )

    await store_workflow_analysis(complaint_id, response)
    return response


@router.get(
    "/complaint-workflow-analysis/{complaint_id}",
    response_model=ComplaintAnalysisResponse,
)
async def complaint_workflow_analysis(
    complaint_id: int,
    stream: bool = Query(False, description="Stream NDJSON log + result events"),
):
    if stream:
        return StreamingResponse(
            stream_with_logs(_run(complaint_id)),
            media_type="application/x-ndjson",
        )
    return await _run(complaint_id)
