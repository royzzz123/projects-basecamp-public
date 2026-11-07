from __future__ import annotations

import json
import logging
import re

from schemas.analysis import ComplaintSummary
from schemas.complaint import ComplaintResponse
from utils.llm import build_json_schema_format, call_llm

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a SEBI grievance analyst. You are given the raw `complaint_details`
text submitted by an investor. Read it carefully and produce a structured summary.

Return ONLY a JSON object with exactly these fields:
{
  "brief_summary": "A neutral 2-4 sentence paragraph summarising what the investor is alleging.",
  "concise_summary": "A single one-line sentence (maximum 15 words) capturing the core of the complaint in one breath.",
  "key_issues": ["short bullet phrases capturing each distinct grievance / failure point"],
  "demands": ["explicit remedies, compensation amounts, or actions the investor is asking for"],
  "sentiment": "One or two words describing the investor's emotional tone (e.g. frustrated, angry, anxious, resigned, neutral).",
  "priority": "One of exactly: \\"normal\\", \\"urgent\\", \\"most urgent\\"."
}

Rules:
- Stick strictly to what the text says — do not invent facts, names, or amounts.
- `concise_summary` must be exactly one short sentence (a single line) — a tighter, one-glance version of `brief_summary`, never a list or multiple sentences.
- `key_issues` and `demands` must be concise phrases (not full sentences); use an empty list if none.
- If the text is empty or missing, return empty strings / empty lists, sentiment "unknown", and priority "normal".

Priority classification (match case-insensitively; obvious paraphrases count, e.g. "elderly" ≈ senior citizen, "no reply" ≈ no response):
- "most urgent" — complaint mentions any of: senior citizen, old person, disability, disable, health or medical emergency, harassment.
- "urgent" — complaint mentions any of: multiple correspondences, no response, urgent. (Only assign "urgent" if no "most urgent" trigger applies.)
- "normal" — everything else, and the default when no trigger words apply.
"""


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


async def summarize(complaint: ComplaintResponse) -> ComplaintSummary:
    details = (complaint.complaint_details or "").strip()
    if not details:
        logger.info(
            "[STEP] Complaint %s has no complaint_details — skipping summarisation",
            complaint.complaint_id,
        )
        return ComplaintSummary(sentiment="unknown", priority="normal")

    logger.info(
        "[STEP] Summarising complaint %s details (chars=%d)",
        complaint.complaint_id, len(details),
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": details},
    ]
    raw = await call_llm(
        "nemotron-3-120b",
        messages=messages,
        temperature=0.2,
        response_format=build_json_schema_format(ComplaintSummary),
    )
    try:
        data = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as e:
        logger.warning("[STEP] Failed to parse summary JSON, returning raw text. err=%s", e)
        return ComplaintSummary(brief_summary=raw)

    key_issues = data.get("key_issues") or []
    demands = data.get("demands") or []
    allowed_priorities = {"normal", "urgent", "most urgent"}
    raw_priority = (data.get("priority") or "").strip().lower()
    if raw_priority not in allowed_priorities:
        if raw_priority:
            logger.warning(
                "[STEP] Unexpected priority value %r from LLM — defaulting to 'normal'",
                raw_priority,
            )
        raw_priority = "normal"
    logger.info(
        "[STEP] Complaint summary parsed (concise=%s, key_issues=%d, demands=%d, sentiment=%s, priority=%s)",
        bool(data.get("concise_summary")), len(key_issues), len(demands), data.get("sentiment"), raw_priority,
    )
    return ComplaintSummary(
        brief_summary=data.get("brief_summary"),
        concise_summary=data.get("concise_summary"),
        key_issues=[str(x) for x in key_issues if x],
        demands=[str(x) for x in demands if x],
        sentiment=data.get("sentiment"),
        priority=raw_priority,
    )
