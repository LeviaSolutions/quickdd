"""Shared schema types used across the API."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---- Enumerations ----

class AssetClass(str, Enum):
    OFFICE = "office"
    LOGISTICS = "logistics"
    RETAIL = "retail"
    RESIDENTIAL = "residential"
    MIXED_USE = "mixed_use"


class ProjectStatus(str, Enum):
    CREATED = "created"
    INGESTING = "ingesting"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    ERROR = "error"


class DocumentStatus(str, Enum):
    UPLOADED = "uploaded"
    DETECTING = "detecting"
    EXTRACTING = "extracting"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    INDEXED = "indexed"
    ERROR = "error"
    SKIPPED = "skipped"


class ConfidenceTier(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INSUFFICIENT_DATA = "insufficient_data"


class AnswerStatus(str, Enum):
    PENDING = "pending"
    GENERATING = "generating"
    GENERATED = "generated"
    REVIEWED = "reviewed"
    OVERRIDDEN = "overridden"
    ERROR = "error"


class Priority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ExpectedFormat(str, Enum):
    YES_NO = "yes_no"
    YES_NO_DETAIL = "yes_no_detail"
    DATE = "date"
    CURRENCY = "currency"
    PERCENTAGE = "percentage"
    NUMERIC = "numeric"
    FREE_TEXT = "free_text"
    LIST = "list"
    TABLE = "table"
    STRUCTURED = "structured"


class ContradictionSeverity(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class UserRole(str, Enum):
    ADMIN = "admin"
    ANALYST = "analyst"
    VIEWER = "viewer"


# ---- Base Schemas ----

class TimestampMixin(BaseModel):
    created_at: datetime
    updated_at: datetime | None = None


class PaginationParams(BaseModel):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=500)


class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    offset: int
    limit: int


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    uptime_seconds: float
    database: str = "connected"
    api_connected: bool = False


class ErrorResponse(BaseModel):
    detail: str
    error_code: str | None = None
