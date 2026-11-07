from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class DocSummary(BaseModel):
    uuid: str
    summary: str | None = None
    error: str | None = None
    ai_generated_name: str | None = None


class DocSummaryContent(BaseModel):
    """LLM-generated portion of a per-document summary; used as the structured-output schema
    for the doc-summary call. The non-LLM fields (uuid, error) live on DocSummary."""
    ai_generated_name: str | None = None
    summary: str | None = None


class EnrichedTimelineEntry(BaseModel):
    at: datetime | None = None
    role: str | None = None
    action: str | None = None
    wfstate: str | None = None
    remarks: str | None = None
    current_assignee_role: str | None = None
    doc_summaries: list[DocSummary] = Field(default_factory=list)


class WorkflowAnalysis(BaseModel):
    timeline_quality: str | None = None
    entity_conduct: str | None = None
    investor_grievance_assessment: str | None = None
    overall_summary: str | None = None


class ComplaintAnalysisResponse(BaseModel):
    complaint_id: int
    complaint_code: str | None = None
    category: str | None = None
    sub_category: str | None = None
    entity_name: str | None = None
    filed_at: datetime | None = None
    closed_at: datetime | None = None
    time_taken_label: str | None = None
    current_status: str | None = None
    enriched_timeline: list[EnrichedTimelineEntry] = Field(default_factory=list)
    workflow_analysis: WorkflowAnalysis = Field(default_factory=WorkflowAnalysis)


class ComplaintSummary(BaseModel):
    brief_summary: str | None = None
    concise_summary: str | None = None
    key_issues: list[str] = Field(default_factory=list)
    demands: list[str] = Field(default_factory=list)
    sentiment: str | None = None
    priority: str | None = None


class ComplaintSummaryResponse(BaseModel):
    complaint_id: int
    complaint_code: str | None = None
    category: str | None = None
    sub_category: str | None = None
    entity_name: str | None = None
    filed_at: datetime | None = None
    complaint_details: str | None = None
    summary: ComplaintSummary = Field(default_factory=ComplaintSummary)
