from __future__ import annotations

import asyncio
import logging

from schemas.analysis import DocSummary, EnrichedTimelineEntry
from schemas.complaint import ComplaintResponse, TimelineEntry
from services.document_processor import process_document

logger = logging.getLogger(__name__)


async def _process_one(complaint_id: int, uuid: str) -> tuple[str, DocSummary]:
    try:
        summary, name = await process_document(complaint_id, uuid)
        return uuid, DocSummary(uuid=uuid, summary=summary, ai_generated_name=name)
    except Exception as e:
        logger.exception("[STEP] uuid=%s document processing failed", uuid)
        return uuid, DocSummary(uuid=uuid, summary=None, error=str(e))


async def build_doc_summary_map(complaint: ComplaintResponse) -> dict[str, DocSummary]:
    """Process every unique doc UUID in the timeline exactly once, in parallel."""
    uuids = complaint.unique_doc_uuids()
    if not uuids:
        logger.info("[STEP] No documents attached to timeline — skipping doc processing")
        return {}
    logger.info("[STEP] Processing %d unique documents in parallel", len(uuids))
    results = await asyncio.gather(*[_process_one(complaint.complaint_id, u) for u in uuids])
    ok = sum(1 for _, ds in results if ds.summary is not None)
    logger.info("[STEP] Document processing complete (%d/%d succeeded)", ok, len(uuids))
    return dict(results)


def enrich_timeline(
    timeline: list[TimelineEntry],
    summaries_by_uuid: dict[str, DocSummary],
) -> list[EnrichedTimelineEntry]:
    enriched: list[EnrichedTimelineEntry] = []
    for entry in timeline:
        doc_summaries = [
            summaries_by_uuid[u]
            for u in entry.doc_urls
            if u in summaries_by_uuid
        ]
        enriched.append(
            EnrichedTimelineEntry(
                at=entry.at,
                role=entry.role,
                action=entry.action,
                wfstate=entry.wfstate,
                remarks=entry.remarks,
                current_assignee_role=entry.current_assignee_role,
                doc_summaries=doc_summaries,
            )
        )
    return enriched
