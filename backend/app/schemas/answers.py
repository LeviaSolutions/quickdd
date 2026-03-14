"""Pydantic schemas for the Answers API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import (
    AnswerStatus,
    ConfidenceTier,
    ContradictionSeverity,
)


class AnswerSourceResponse(BaseModel):
    """Citation link tying an answer to a source chunk or table."""

    id: str
    chunk_id: str | None
    table_id: str | None
    relevance_score: float
    rank_position: int
    # Denormalized for display convenience
    document_filename: str | None = None
    page_number: int | None = None
    text_preview: str | None = None


class AnswerResponse(BaseModel):
    """Full answer with provenance."""

    id: str
    project_id: str
    question_id: str
    answer_text: str
    confidence_tier: ConfidenceTier
    confidence_score: float
    retrieval_score: float | None
    consistency_score: float | None
    hop_count: int
    model_used: str
    prompt_tokens: int | None
    completion_tokens: int | None
    processing_time_ms: int | None
    status: AnswerStatus
    sources: list[AnswerSourceResponse]
    contradictions: list["ContradictionResponse"]
    override: "OverrideResponse | None"
    review_signoff: "ReviewSignoffResponse | None"
    created_at: datetime
    updated_at: datetime


class AnswerListItem(BaseModel):
    """Compact answer for list/matrix views."""

    id: str
    question_id: str
    answer_text: str
    confidence_tier: ConfidenceTier
    confidence_score: float
    status: AnswerStatus
    hop_count: int
    source_count: int
    has_contradictions: bool
    has_override: bool
    has_signoff: bool


class ContradictionResponse(BaseModel):
    """Detected contradiction between sources."""

    id: str
    answer_id: str
    source_a_chunk_id: str | None
    source_b_chunk_id: str | None
    description: str
    severity: ContradictionSeverity
    resolved: bool
    resolved_by: str | None
    resolution_note: str | None
    created_at: datetime


class ContradictionResolve(BaseModel):
    """Request to resolve a contradiction."""

    resolved_by: str
    resolution_note: str


class OverrideCreate(BaseModel):
    """Request to manually override an answer."""

    override_text: str = Field(..., min_length=1)
    user_name: str = Field(..., min_length=1)
    reason: str | None = None


class OverrideResponse(BaseModel):
    """Stored manual override."""

    id: str
    answer_id: str
    override_text: str
    user_name: str
    reason: str | None
    created_at: datetime


class ReviewSignoffCreate(BaseModel):
    """Request to sign off on a critical-priority answer."""

    reviewer_name: str = Field(..., min_length=1)
    comment: str | None = None


class ReviewSignoffResponse(BaseModel):
    """Stored review signoff."""

    id: str
    answer_id: str
    reviewer_name: str
    signed_off_at: datetime
    comment: str | None


# Rebuild forward refs
AnswerResponse.model_rebuild()
