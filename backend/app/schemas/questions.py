"""Pydantic schemas for the Questions API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import (
    AssetClass,
    ConfidenceTier,
    ExpectedFormat,
    Priority,
)


class QuestionResponse(BaseModel):
    """Full question catalogue entry."""

    id: str
    category: str
    subcategory: str | None
    asset_classes: list[AssetClass]
    question_de: str
    question_en: str
    expected_format: ExpectedFormat
    search_keywords_de: list[str]
    search_keywords_en: list[str]
    priority: Priority
    source_hint: str | None
    llm_instruction: str | None
    validation_rule: str | None
    depends_on: list[str]
    severity_weight: int
    regulatory_reference: str | None
    requires_table_qa: bool
    multi_hop_required: bool


class QuestionFilter(BaseModel):
    """Query parameters for filtering questions."""

    category: str | None = None
    asset_class: AssetClass | None = None
    priority: Priority | None = None
    requires_table_qa: bool | None = None
    multi_hop_required: bool | None = None


class AnswerResponse(BaseModel):
    """Answer to a question for a specific project."""

    id: str
    project_id: str
    question_id: str
    answer_text: str
    short_answer: str = ""
    confidence_tier: str
    confidence_score: float
    retrieval_score: float | None = None
    consistency_score: float | None = None
    hop_count: int = 1
    model_used: str
    status: str
    created_at: datetime
    updated_at: datetime


class QuestionAnswerPairResponse(BaseModel):
    """A question paired with its optional answer."""

    question: QuestionResponse
    answer: AnswerResponse | None = None


class CustomQuestionCreate(BaseModel):
    """Request body to create a custom question for a project."""

    category: str
    question_de: str = Field(..., min_length=1)
    question_en: str = ""
    expected_format: str = "free_text"
    priority: str = "medium"


class QuestionExecutionRequest(BaseModel):
    """Request to execute questions for a project."""

    project_id: str
    question_ids: list[str] | None = None  # None = all applicable
    force_rerun: bool = False


class QuestionExecutionStatus(BaseModel):
    """Status update during question execution."""

    question_id: str
    status: str  # pending, running, completed, error
    progress: float  # 0.0 - 1.0
    message: str | None = None
