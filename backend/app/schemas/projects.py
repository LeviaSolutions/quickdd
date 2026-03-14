"""Pydantic schemas for the Projects API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import AssetClass, ProjectStatus


class ProjectCreate(BaseModel):
    """Request body to create a new project."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    asset_class: AssetClass
    language: str = Field(default="de", pattern=r"^(de|en)$")
    question_catalogue_ids: list[str] | None = None  # If None, use all for asset class


class ProjectUpdate(BaseModel):
    """Request body to update project metadata."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    asset_class: AssetClass | None = None
    status: ProjectStatus | None = None
    language: str | None = Field(default=None, pattern=r"^(de|en)$")


class ProjectResponse(BaseModel):
    """Full project representation returned by the API."""

    id: str
    name: str
    description: str
    asset_class: AssetClass
    status: ProjectStatus
    file_count: int
    question_count: int
    answered_count: int
    language: str
    created_at: datetime
    updated_at: datetime


class ProjectSummary(BaseModel):
    """Lightweight project representation for list views."""

    id: str
    name: str
    description: str = ""
    asset_class: AssetClass
    status: ProjectStatus
    file_count: int
    question_count: int
    answered_count: int
    coverage_percentage: float = 0.0
    red_flag_count: int = 0
    created_at: datetime
    updated_at: datetime | None = None
