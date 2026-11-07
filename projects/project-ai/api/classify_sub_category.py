"""GET /classify-sub-category/{complaint_id} — re-categorise a single complaint filed as 'Others'.

Same call shape (and underlying CRUD round-trip) the backfill script uses, so
this endpoint is also the trigger point for the systemd timer that polls for
new Others complaints on the air-gapped SEBI server.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.complaint_client import ComplaintFetchError, ComplaintNotFound
from services.sub_category_classifier import (
    ClassifierError,
    ClassificationResult,
    classify_sub_category,
)
from utils.llm import LLMError

logger = logging.getLogger(__name__)

router = APIRouter()


class ClassifyResponse(BaseModel):
    complaint_id: int
    suggested_sub_category: str | None
    confidence: int
    reasoning: str
    model: str
    persisted: bool
    candidates_considered: int

    @classmethod
    def from_result(cls, r: ClassificationResult) -> "ClassifyResponse":
        return cls(
            complaint_id=r.complaint_id,
            suggested_sub_category=r.suggested_sub_category,
            confidence=r.confidence,
            reasoning=r.reasoning,
            model=r.model,
            persisted=r.persisted,
            candidates_considered=r.candidates_considered,
        )


@router.get("/classify-sub-category/{complaint_id}", response_model=ClassifyResponse)
async def classify(complaint_id: int) -> ClassifyResponse:
    try:
        result = await classify_sub_category(complaint_id)
    except ComplaintNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ClassifierError as exc:
        # ClassifierError covers "not Others", "no candidates", "unparseable LLM
        # output" — actionable issues the caller can either fix or skip.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMError as exc:
        # 502 because the upstream LLM provider failed — same convention as
        # the existing complaint-summary pipeline.
        raise HTTPException(status_code=502, detail=f"LLM call failed: {exc}") from exc
    except ComplaintFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ClassifyResponse.from_result(result)
