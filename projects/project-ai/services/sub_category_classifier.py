"""
Sub-category classifier for complaints filed as "Others".

Given a complaint id, this module:
  1. Fetches the complaint via the CRUD client (complaint_details + parent
     category).
  2. Looks up the valid sub-categories for that parent category by querying
     CRUD's /v1/dashboard/volume-by-subcategory endpoint scoped to the
     parent category — that endpoint already does the "distinct sub-categories
     present in real data for this category" aggregation we'd otherwise need
     to repeat here.
  3. Builds a constrained-output prompt and calls the configured LLM.
  4. Validates the LLM's pick against the known label set (refusing to invent
     new categories) and POSTs the resulting suggestion back to CRUD's
     /v1/complaints/:id/reclassification endpoint.

The module is intentionally stateless — the FastAPI route in
api/classify_sub_category.py only thin-wraps `classify_sub_category()`.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from config.settings import settings
from services.complaint_client import (
    ComplaintFetchError,
    ComplaintNotFound,
    fetch_complaint,
)
from utils.crud_client import get_client
from utils.llm import LLMError, call_llm

logger = logging.getLogger(__name__)


# The "Others" sentinel — kept here (not imported) so the AI service stays
# decoupled from the CRUD source. Same string both sides; if it ever changes
# both repos need the update.
OTHERS = "Others"

# Lower bound on the number of valid candidate sub-categories below which we
# refuse to classify. Set to 2 because real SEBI data has parents (e.g. cat32)
# with only 2 valid sub-categories — refusing those left too many Others
# complaints un-classified. A 2-way pick is still a meaningful signal; the
# LLM-emitted `confidence` score lets supervisors filter out low-quality picks
# downstream. 1 candidate would be degenerate and is still refused.
MIN_CANDIDATES = 2

# Max number of valid candidate labels we include in the prompt. Truncating
# protects the token budget for parent categories with very long sub-cat
# lists (Listed Company has ~50). The endpoint returns them sorted by
# real-world frequency, so a top-N cut keeps the dominant ones.
MAX_CANDIDATES_IN_PROMPT = 60


class ClassifierError(RuntimeError):
    """Raised when classification cannot be completed for actionable reasons.

    The FastAPI handler maps this to HTTP 422 — the caller can either fix the
    inputs or rerun later.
    """


@dataclass
class ClassificationResult:
    """What a single classification produces. Mirrors the response body of the
    POST /classify-sub-category endpoint plus a `persisted` flag so callers
    can detect dry-run vs real writes."""

    complaint_id: int
    suggested_sub_category: str | None
    confidence: int
    reasoning: str
    model: str
    persisted: bool
    candidates_considered: int


async def classify_sub_category(complaint_id: int, *, persist: bool = True) -> ClassificationResult:
    """Run the full pipeline for one complaint. Raises:

    - ComplaintNotFound when CRUD returns 404
    - ClassifierError on workflow problems (complaint isn't 'Others', no
      candidates, LLM returned nonsense, etc.)
    - LLMError when the underlying model call itself failed
    - ComplaintFetchError on lower-level CRUD/network issues
    """
    existing = await _fetch_existing_reclassification(complaint_id)
    if existing is not None:
        logger.info("Returning existing reclassification for complaint %s", complaint_id)
        return existing

    complaint = await fetch_complaint(complaint_id)
    if (complaint.sub_category or "") != OTHERS:
        raise ClassifierError(
            f"complaint {complaint_id} sub_category is "
            f"{complaint.sub_category!r}, not {OTHERS!r} — nothing to reclassify"
        )

    parent_code = complaint.category.code if complaint.category else None
    parent_name = complaint.category.name if complaint.category else None
    if not parent_code:
        raise ClassifierError(
            f"complaint {complaint_id} has no parent category — can't constrain candidates"
        )

    candidates = await _fetch_candidate_sub_categories(parent_code)
    if len(candidates) < MIN_CANDIDATES:
        raise ClassifierError(
            f"only {len(candidates)} candidate sub-categories for category "
            f"{parent_code!r}; refusing to classify with so little signal"
        )

    # Trim to the prompt budget. Live data is sorted by frequency descending,
    # so we keep the most common N for a fairer pick.
    prompt_candidates = candidates[:MAX_CANDIDATES_IN_PROMPT]

    llm_text = await _call_classifier_llm(
        complaint_details=complaint.complaint_details or "",
        atr_remarks=_pick_atr_remarks(complaint),
        parent_category_name=parent_name or parent_code,
        candidates=prompt_candidates,
    )
    parsed = _parse_llm_json(llm_text)

    # Validate the LLM's pick — must be either null/empty (genuine Others) or
    # one of the candidate labels we sent it. Anything else is a hallucination
    # and we discard it.
    suggested = parsed.get("sub_category") or None
    if suggested is not None and suggested not in prompt_candidates:
        logger.warning(
            "LLM returned unknown sub_category %r for complaint %s — treating as no match",
            suggested,
            complaint_id,
        )
        suggested = None

    confidence = _clamp(int(float(parsed.get("confidence") or 0)), 0, 100)
    reasoning = str(parsed.get("reasoning") or "").strip()[:2000]

    # We only persist a *useful* suggestion — i.e., one that picks a non-Others
    # label. "LLM said genuinely Others" still has value, but until the FE
    # treats it as a signal we'd rather not pollute the sidecar fields.
    persisted = False
    if persist and suggested is not None:
        await _post_suggestion_to_crud(
            complaint_id,
            suggested_sub_category=suggested,
            confidence=confidence,
            reasoning=reasoning,
        )
        persisted = True

    return ClassificationResult(
        complaint_id=complaint_id,
        suggested_sub_category=suggested,
        confidence=confidence,
        reasoning=reasoning,
        model=settings.reclassify_model,
        persisted=persisted,
        candidates_considered=len(prompt_candidates),
    )


# ── Internals ─────────────────────────────────────────────────────────────


async def _fetch_existing_reclassification(complaint_id: int) -> ClassificationResult | None:
    """Returns the already-stored reclassification from CRUD if one exists, else None."""
    url = f"/v1/complaints/{complaint_id}/reclassification"
    resp = await get_client().get(url)
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise ComplaintFetchError(
            f"reclassification GET returned {resp.status_code}: {resp.text[:300]}"
        )
    suggestion = (resp.json().get("suggestion") or {})
    if not suggestion:
        return None
    return ClassificationResult(
        complaint_id=complaint_id,
        suggested_sub_category=suggestion.get("ai_generated_sub_category"),
        confidence=_clamp(int(suggestion.get("confidence") or 0), 0, 100),
        reasoning=str(suggestion.get("reasoning") or "").strip(),
        model="",
        persisted=True,
        candidates_considered=0,
    )


async def _fetch_candidate_sub_categories(parent_category_code: str) -> list[str]:
    """Returns the valid sub-category labels for a parent category, ordered by
    real-world frequency descending. Skips 'Others' (the bucket we're
    reclassifying *out of*) and any empty labels.
    """
    url = "/v1/dashboard/volume-by-subcategory"
    params = {"category": parent_category_code, "limit": 200}
    resp = await get_client().get(url, params=params)
    if resp.status_code >= 400:
        raise ComplaintFetchError(
            f"volume-by-subcategory returned {resp.status_code}: {resp.text[:300]}"
        )
    items = resp.json().get("items") or []
    out: list[str] = []
    for it in items:
        name = (it.get("sub_category") or "").strip()
        if name and name != OTHERS:
            out.append(name)
    return out


def _pick_atr_remarks(complaint) -> str:  # type: ignore[no-untyped-def]
    """Best-effort grab of the entity's ATR remarks. Falls back to empty when
    no ATR step has been logged yet. Capped at 600 chars to keep the prompt
    tight."""
    for entry in complaint.activity_timeline:
        if (entry.action or "").upper() == "ATR" and entry.remarks:
            return str(entry.remarks).strip()[:600]
    return ""


async def _call_classifier_llm(
    *,
    complaint_details: str,
    atr_remarks: str,
    parent_category_name: str,
    candidates: list[str],
) -> str:
    """Builds the prompt and invokes the configured model. Always asks for a
    JSON object response when the model supports it."""
    numbered = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(candidates))
    user = (
        f"Parent category: {parent_category_name}\n\n"
        "Valid sub-categories (you must choose one of these — copy it EXACTLY,\n"
        "preserving punctuation, spacing and casing — or return null if none "
        "fits):\n"
        f"{numbered}\n\n"
        f"Complaint text:\n{complaint_details.strip() or '(empty)'}\n"
    )
    if atr_remarks:
        user += f"\nEntity ATR remarks:\n{atr_remarks}\n"

    user += (
        "\nPick the single best fit. Output strict JSON only:\n"
        '{"sub_category": <string from the list above OR null>, '
        '"confidence": <0-100 integer>, '
        '"reasoning": <one-sentence justification, max 200 chars>}'
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert SEBI complaint classifier. Given an investor's "
                "complaint that was originally filed under 'Others', pick the most "
                "appropriate sub-category from the supplied closed list. If the "
                "complaint genuinely does not match any option, return null for "
                "sub_category. Never invent new categories. Always return strict JSON."
            ),
        },
        {"role": "user", "content": user},
    ]

    return await call_llm(
        model=settings.reclassify_model,
        messages=messages,
        temperature=0.1,
        max_tokens=settings.reclassify_max_tokens,
        response_format={"type": "json_object"},
    )


_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_llm_json(raw: str) -> dict:
    """Robust-ish JSON extraction. Most CDAC models honour `response_format`
    cleanly, but reasoning models can wrap the JSON in commentary. Extract the
    first {...} block and parse that."""
    raw = (raw or "").strip()
    if not raw:
        raise ClassifierError("LLM returned empty output")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    m = _JSON_OBJECT_RE.search(raw)
    if not m:
        raise ClassifierError(f"LLM output not parseable as JSON: {raw[:200]!r}")
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise ClassifierError(f"LLM output not parseable as JSON: {raw[:200]!r}") from exc


async def _post_suggestion_to_crud(
    complaint_id: int,
    *,
    suggested_sub_category: str,
    confidence: int,
    reasoning: str,
) -> None:
    url = f"/v1/complaints/{complaint_id}/reclassification"
    payload = {
        "ai_generated_sub_category": suggested_sub_category,
        "confidence": confidence,
        "reasoning": reasoning,
    }
    resp = await get_client().post(url, json=payload)
    if resp.status_code >= 400:
        raise ComplaintFetchError(
            f"reclassification POST returned {resp.status_code}: {resp.text[:300]}"
        )


def _clamp(n: int, lo: int, hi: int) -> int:
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


__all__ = [
    "ClassificationResult",
    "ClassifierError",
    "classify_sub_category",
]
