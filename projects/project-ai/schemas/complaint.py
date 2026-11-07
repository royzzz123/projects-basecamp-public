from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Category(BaseModel):
    code: str | None = None
    name: str | None = None


class Entity(BaseModel):
    model_config = ConfigDict(extra="allow")
    screen_id: str | None = None
    name: str | None = None
    type: str | None = None
    category_code: str | None = None
    category_name: str | None = None
    registration_number: str | None = None


class StatusProgressionEntry(BaseModel):
    state: str
    reached_at: datetime | None = None
    current: bool = False


class TimelineEntry(BaseModel):
    model_config = ConfigDict(extra="allow")
    log_id: int | None = None
    at: datetime | None = None
    role: str | None = None
    action: str | None = None
    wfstate: str | None = None
    remarks: str | None = None
    doc_urls: list[str] = Field(default_factory=list)
    current_assignee_role: str | None = None


class ComplaintResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    complaint_id: int
    complaint_code: str | None = None
    complaint_details: str | None = None
    sub_category: str | None = None
    category: Category | None = None
    filed_date: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    closed_at: datetime | None = None
    time_taken_seconds: int | None = None
    time_taken_label: str | None = None
    current_status: str | None = None
    entity: Entity | None = None
    status_progression: list[StatusProgressionEntry] = Field(default_factory=list)
    activity_timeline: list[TimelineEntry] = Field(default_factory=list)
    doc_urls: list[str] = Field(default_factory=list)

    def unique_doc_uuids(self) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for entry in self.activity_timeline:
            for uuid in entry.doc_urls:
                if uuid and uuid not in seen:
                    seen.add(uuid)
                    ordered.append(uuid)
        return ordered

    def as_llm_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
