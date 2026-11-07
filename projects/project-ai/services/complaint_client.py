from __future__ import annotations

import logging

from config.settings import settings
from schemas.complaint import ComplaintResponse
from utils.crud_client import get_client

logger = logging.getLogger(__name__)


class ComplaintNotFound(Exception):
    pass


class ComplaintFetchError(RuntimeError):
    pass


async def fetch_complaint(complaint_id: int) -> ComplaintResponse:
    url = f"/v1/complaints/{complaint_id}"
    logger.info("[STEP] Fetching complaint from CRUD: %s%s", settings.crud_base_url, url)
    resp = await get_client().get(url)
    if resp.status_code == 404:
        raise ComplaintNotFound(f"Complaint {complaint_id} not found")
    if resp.status_code >= 400:
        raise ComplaintFetchError(f"CRUD returned {resp.status_code}: {resp.text[:500]}")
    parsed = ComplaintResponse.model_validate(resp.json())
    logger.info(
        "[STEP] Fetched complaint id=%s code=%s timeline_entries=%d unique_docs=%d",
        parsed.complaint_id,
        parsed.complaint_code,
        len(parsed.activity_timeline),
        len(parsed.unique_doc_uuids()),
    )
    return parsed
