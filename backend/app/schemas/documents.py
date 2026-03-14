"""Pydantic schemas for the Documents API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import DocumentStatus


class FolderUploadRequest(BaseModel):
    """Request to ingest all supported files from a local folder."""

    folder_path: str
    recursive: bool = True


class DocumentUploadResponse(BaseModel):
    """Returned after a file is uploaded and queued for processing."""

    id: str
    filename: str
    file_size: int
    mime_type: str
    status: DocumentStatus


class DocumentResponse(BaseModel):
    """Full document metadata."""

    id: str
    project_id: str
    filename: str
    file_size: int
    mime_type: str
    file_hash: str
    page_count: int | None
    ocr_confidence: float | None
    is_encrypted: bool
    status: DocumentStatus
    error_message: str | None
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    """Compact document representation for list views."""

    id: str
    filename: str
    mime_type: str
    file_size: int
    status: DocumentStatus
    page_count: int | None
    ocr_confidence: float | None
    created_at: datetime


class ChunkResponse(BaseModel):
    """Individual text chunk with metadata."""

    id: str
    document_id: str
    chunk_index: int
    text: str
    page_number: int | None
    section: str | None
    token_count: int


class TableResponse(BaseModel):
    """Structured table extraction result."""

    id: str
    document_id: str
    table_index: int
    page_number: int | None
    caption: str | None
    headers: list[str]
    rows: list[list[Any]]
    row_count: int
    col_count: int
    table_type: str | None
