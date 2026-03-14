"""Pydantic schemas for the Reports API."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class ReportType(str, Enum):
    FULL_DD = "full_dd"
    EXECUTIVE_SUMMARY = "executive_summary"
    RED_FLAGS = "red_flags"
    CATEGORY = "category"
    QA_MATRIX = "qa_matrix"
    CONFIDENCE_SUMMARY = "confidence_summary"


class ReportFormat(str, Enum):
    DOCX = "docx"
    PDF = "pdf"
    XLSX = "xlsx"


class BrandingConfig(BaseModel):
    """Custom branding settings for report generation."""

    company_name: str | None = None
    logo_path: str | None = None
    primary_color: str = Field(default="#1a365d", pattern=r"^#[0-9a-fA-F]{6}$")
    secondary_color: str = Field(default="#2b6cb0", pattern=r"^#[0-9a-fA-F]{6}$")
    header_text: str | None = None
    footer_text: str | None = None
    classification: str = "Confidential"


class ReportGenerateRequest(BaseModel):
    """Request to generate a report."""

    project_id: str
    report_type: ReportType
    format: ReportFormat
    branding: BrandingConfig | None = None
    category_filter: str | None = None  # For CATEGORY report type
    language: str = Field(default="de", pattern=r"^(de|en)$")
    include_sources: bool = True
    include_confidence: bool = True


class ReportResponse(BaseModel):
    """Metadata about a generated report."""

    id: str
    project_id: str
    report_type: ReportType
    format: ReportFormat
    filename: str
    file_size: int
    download_path: str
    created_at: str
