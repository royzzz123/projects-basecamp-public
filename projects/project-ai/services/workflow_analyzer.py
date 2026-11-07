from __future__ import annotations

import json
import logging
import re

from schemas.analysis import EnrichedTimelineEntry, WorkflowAnalysis
from schemas.complaint import ComplaintResponse
from utils.llm import build_json_schema_format, call_llm

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a senior SEBI grievance redressal analyst. You are given a SCORES
complaint record and its enriched activity timeline (each timeline entry includes the date, the
acting role, the action, the workflow state, the remark, and summaries of any documents attached
at that step).

Analyse the case along three dimensions:

1. timeline_quality — Examine dates, gaps between stages, reminders triggered, and overall
   resolution time. Identify any SLA breaches, stuck stages, or unusual delays. Note who held
   the case the longest.

2. entity_conduct — Assess the intermediary/entity's behaviour: how quickly and substantively
   did they respond? Was the ATR (Action Taken Report) of good quality? Did they engage in
   good faith with the investor's grievance?

3. investor_grievance_assessment — Is the complaint substantive and specific? Was it adequately
   addressed at each review level? Was the eventual closure justified given the facts? Was the
   investor pointed toward appropriate further recourse (e.g. ODR/SmartODR)?

Finally, write a one-paragraph overall_summary tying these together.

Be specific — cite dates, roles, and document findings from the timeline. Do not invent facts.

Return ONLY a JSON object with exactly these four string fields:
{
  "timeline_quality": "...",
  "entity_conduct": "...",
  "investor_grievance_assessment": "...",
  "overall_summary": "..."
}
"""


def _build_user_payload(
    complaint: ComplaintResponse, enriched_timeline: list[EnrichedTimelineEntry]
) -> str:
    payload = {
        "complaint": {
            "complaint_id": complaint.complaint_id,
            "complaint_code": complaint.complaint_code,
            "complaint_details": complaint.complaint_details,
            "category": complaint.category.name if complaint.category else None,
            "sub_category": complaint.sub_category,
            "filed_date": complaint.filed_date.isoformat() if complaint.filed_date else None,
            "closed_at": complaint.closed_at.isoformat() if complaint.closed_at else None,
            "time_taken_label": complaint.time_taken_label,
            "current_status": complaint.current_status,
            "entity": complaint.entity.model_dump(mode="json") if complaint.entity else None,
        },
        "status_progression": [
            sp.model_dump(mode="json") for sp in complaint.status_progression
        ],
        "enriched_timeline": [e.model_dump(mode="json") for e in enriched_timeline],
    }
    return json.dumps(payload, indent=2, default=str)


def _extract_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Model output did not contain a JSON object: {text[:300]}")
    return json.loads(match.group(0))


async def analyze(
    complaint: ComplaintResponse, enriched_timeline: list[EnrichedTimelineEntry]
) -> WorkflowAnalysis:
    logger.info(
        "[STEP] Running workflow analysis (complaint_id=%s, timeline_entries=%d)",
        complaint.complaint_id, len(enriched_timeline),
    )
    user_content = _build_user_payload(complaint, enriched_timeline)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    raw = await call_llm(
        "nemotron-3-120b",
        messages=messages,
        temperature=0.2,
        response_format=build_json_schema_format(WorkflowAnalysis),
    )
    try:
        data = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as e:
        logger.warning("[STEP] Failed to parse analysis JSON, returning raw text. err=%s", e)
        return WorkflowAnalysis(overall_summary=raw)
    logger.info("[STEP] Workflow analysis complete (4 sections parsed)")
    return WorkflowAnalysis(
        timeline_quality=data.get("timeline_quality"),
        entity_conduct=data.get("entity_conduct"),
        investor_grievance_assessment=data.get("investor_grievance_assessment"),
        overall_summary=data.get("overall_summary"),
    )
