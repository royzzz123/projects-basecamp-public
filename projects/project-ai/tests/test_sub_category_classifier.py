"""Unit tests for the sub-category classifier internals.

We don't exercise the HTTP wiring or the LLM here — those go through the
existing live smoke tests. These cover the deterministic bits: JSON parsing,
candidate fetching, ATR remarks extraction, validation against the candidate
set.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from schemas.complaint import Category, ComplaintResponse, TimelineEntry
from services.sub_category_classifier import (
    ClassifierError,
    _parse_llm_json,
    _pick_atr_remarks,
    classify_sub_category,
)


# ── _parse_llm_json ───────────────────────────────────────────────────


def test_parse_llm_json_strict() -> None:
    out = _parse_llm_json('{"sub_category": "X", "confidence": 87}')
    assert out["sub_category"] == "X"
    assert out["confidence"] == 87


def test_parse_llm_json_wrapped_in_commentary() -> None:
    raw = "Sure! Here's the answer:\n```json\n" + '{"sub_category": "X", "confidence": 5}' + "\n```"
    out = _parse_llm_json(raw)
    assert out["sub_category"] == "X"


def test_parse_llm_json_rejects_garbage() -> None:
    with pytest.raises(ClassifierError):
        _parse_llm_json("definitely not json")


def test_parse_llm_json_rejects_empty() -> None:
    with pytest.raises(ClassifierError):
        _parse_llm_json("")


# ── _pick_atr_remarks ──────────────────────────────────────────────────


def _complaint_with_timeline(entries: list[TimelineEntry]) -> ComplaintResponse:
    return ComplaintResponse(
        complaint_id=1,
        sub_category="Others",
        category=Category(code="cat12", name="Stock Broker"),
        activity_timeline=entries,
    )


def test_pick_atr_remarks_finds_first_atr() -> None:
    c = _complaint_with_timeline(
        [
            TimelineEntry(action="REMINDER_1", remarks="ignored"),
            TimelineEntry(action="ATR", remarks="  We replied within SLA.  "),
            TimelineEntry(action="ATR", remarks="second ATR"),
        ]
    )
    assert _pick_atr_remarks(c) == "We replied within SLA."


def test_pick_atr_remarks_empty_when_no_atr() -> None:
    c = _complaint_with_timeline([TimelineEntry(action="REMINDER_1", remarks="x")])
    assert _pick_atr_remarks(c) == ""


def test_pick_atr_remarks_caps_at_600_chars() -> None:
    long = "x" * 1000
    c = _complaint_with_timeline([TimelineEntry(action="ATR", remarks=long)])
    assert len(_pick_atr_remarks(c)) == 600


# ── classify_sub_category (mocked deps) ────────────────────────────────


@pytest.mark.asyncio
async def test_classify_rejects_non_others() -> None:
    c = ComplaintResponse(
        complaint_id=1,
        sub_category="Delay in processing",
        category=Category(code="cat12", name="Stock Broker"),
    )
    with patch("services.sub_category_classifier.fetch_complaint", AsyncMock(return_value=c)):
        with pytest.raises(ClassifierError, match="not 'Others'"):
            await classify_sub_category(1)


@pytest.mark.asyncio
async def test_classify_rejects_missing_parent_category() -> None:
    c = ComplaintResponse(complaint_id=1, sub_category="Others", category=None)
    with patch("services.sub_category_classifier.fetch_complaint", AsyncMock(return_value=c)):
        with pytest.raises(ClassifierError, match="no parent category"):
            await classify_sub_category(1)


@pytest.mark.asyncio
async def test_classify_drops_hallucinated_label() -> None:
    """When the LLM returns a sub-category that isn't in our candidate list
    we treat it as a hallucination and surface None instead of persisting."""
    c = ComplaintResponse(
        complaint_id=1,
        sub_category="Others",
        category=Category(code="cat12", name="Stock Broker"),
        complaint_details="My broker isn't picking up calls.",
    )
    candidates = [
        "Improper Service",
        "Lack of response from RTA / Improper service",
        "Account opening / closing / suspension related",
    ]

    llm_payload = '{"sub_category": "Made up label", "confidence": 80, "reasoning": "x"}'

    with (
        patch("services.sub_category_classifier.fetch_complaint", AsyncMock(return_value=c)),
        patch(
            "services.sub_category_classifier._fetch_candidate_sub_categories",
            AsyncMock(return_value=candidates),
        ),
        patch(
            "services.sub_category_classifier.call_llm",
            AsyncMock(return_value=llm_payload),
        ),
        patch(
            "services.sub_category_classifier._post_suggestion_to_crud",
            AsyncMock(),
        ) as poster,
    ):
        out = await classify_sub_category(1)

    assert out.suggested_sub_category is None
    assert out.persisted is False
    poster.assert_not_called()


@pytest.mark.asyncio
async def test_classify_happy_path_persists() -> None:
    c = ComplaintResponse(
        complaint_id=42,
        sub_category="Others",
        category=Category(code="cat12", name="Stock Broker"),
        complaint_details="The broker delayed my withdrawal by 21 days.",
        activity_timeline=[
            TimelineEntry(
                action="ATR",
                remarks="Refund was processed on time.",
                at=datetime.now(tz=timezone.utc),
            ),
        ],
    )
    candidates = [
        "Improper Service",
        "Delay in processing / Non-acceptance of change in KYC details",
        "Withdrawal of funds related",
    ]
    llm_payload = (
        '{"sub_category": "Withdrawal of funds related", '
        '"confidence": 91, '
        '"reasoning": "Complaint explicitly mentions a delayed withdrawal."}'
    )

    with (
        patch("services.sub_category_classifier.fetch_complaint", AsyncMock(return_value=c)),
        patch(
            "services.sub_category_classifier._fetch_candidate_sub_categories",
            AsyncMock(return_value=candidates),
        ),
        patch("services.sub_category_classifier.call_llm", AsyncMock(return_value=llm_payload)),
        patch(
            "services.sub_category_classifier._post_suggestion_to_crud",
            AsyncMock(),
        ) as poster,
    ):
        out = await classify_sub_category(42)

    assert out.suggested_sub_category == "Withdrawal of funds related"
    assert out.confidence == 91
    assert out.persisted is True
    poster.assert_called_once()
