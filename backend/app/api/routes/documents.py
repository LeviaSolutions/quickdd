"""Document upload and management API routes."""

from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Annotated

import asyncpg
import orjson
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    UploadFile,
    status,
)

from app.core.auth import BearerAuth
from app.core.config import settings
from app.db.postgres import get_db, get_pool
from app.schemas.documents import (
    ChunkResponse,
    DocumentListItem,
    DocumentResponse,
    DocumentUploadResponse,
    FolderUploadRequest,
    TableResponse,
)

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


@router.post(
    "",
    response_model=list[DocumentUploadResponse],
    status_code=status.HTTP_201_CREATED,
)
async def upload_documents(
    project_id: str,
    files: list[UploadFile],
    background_tasks: BackgroundTasks,
    request: Request,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Upload one or more files to a project for processing."""
    # Verify project exists
    row = await db.fetchrow(
        "SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    results: list[DocumentUploadResponse] = []
    tmp_paths: list[Path] = []

    for file in files:
        # Sanitize filename: strip path components, disallow traversal
        raw_name = file.filename or f"upload_{uuid.uuid4().hex[:8]}"
        safe_name = Path(raw_name).name  # Strip any directory components
        safe_name = safe_name.replace("..", "_").replace("/", "_").replace("\\", "_")
        if not safe_name or safe_name.startswith("."):
            safe_name = f"upload_{uuid.uuid4().hex[:8]}"

        # Save to temp location
        tmp_dir = Path(tempfile.mkdtemp(prefix="dda_upload_"))
        tmp_path = tmp_dir / safe_name

        with open(tmp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Detect MIME type
        from app.parsers.registry import detect_mime_type
        mime = detect_mime_type(tmp_path)

        results.append(
            DocumentUploadResponse(
                id="pending",  # Will be assigned during processing
                filename=tmp_path.name,
                file_size=len(content),
                mime_type=mime,
                status="uploaded",
            )
        )
        tmp_paths.append(tmp_path)

    # Queue processing in background
    background_tasks.add_task(
        _process_uploaded_files,
        project_id,
        tmp_paths,
        request.app.state.vector_store,
    )

    return results


# Supported file extensions for folder scanning
_SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".pptx",
    ".eml", ".msg", ".txt", ".md", ".rtf",
    ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp",
    ".zip", ".7z", ".rar",
    ".xml", ".json", ".dxf",
}


@router.post(
    "/folder",
    response_model=list[DocumentUploadResponse],
    status_code=status.HTTP_201_CREATED,
)
async def upload_folder(
    project_id: str,
    body: FolderUploadRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Ingest all supported files from a local folder path."""
    # Verify project exists
    row = await db.fetchrow(
        "SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    folder = Path(body.folder_path)
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    # Collect all supported files
    file_paths: list[Path] = []
    pattern = "**/*" if body.recursive else "*"
    for p in folder.glob(pattern):
        if p.is_file() and p.suffix.lower() in _SUPPORTED_EXTENSIONS:
            file_paths.append(p)

    if not file_paths:
        raise HTTPException(
            status_code=400,
            detail="No supported files found in the folder",
        )

    # Build response with file info
    from app.parsers.registry import detect_mime_type

    results: list[DocumentUploadResponse] = []
    for fp in file_paths:
        mime = detect_mime_type(fp)
        results.append(
            DocumentUploadResponse(
                id="pending",
                filename=fp.name,
                file_size=fp.stat().st_size,
                mime_type=mime,
                status="uploaded",
            )
        )

    # Queue processing in background (files stay in-place, no temp copies needed)
    background_tasks.add_task(
        _process_folder_files,
        project_id,
        file_paths,
        request.app.state.vector_store,
    )

    return results


async def _process_folder_files(
    project_id: str,
    file_paths: list[Path],
    vector_store,
):
    """Background task to process files from a local folder."""
    from app.services.processing.pipeline import DocumentPipeline

    pool = await get_pool()
    async with pool.acquire() as db:
        pipeline = DocumentPipeline(
            db=db,
            vector_store=vector_store,
            embedding_fn=None,
        )

        for file_path in file_paths:
            try:
                await pipeline.process_file(project_id, file_path)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).error(
                    "Processing failed for %s: %s", file_path, exc
                )


async def _process_uploaded_files(
    project_id: str,
    file_paths: list[Path],
    vector_store,
):
    """Background task to process uploaded files through the pipeline."""
    from app.services.processing.pipeline import DocumentPipeline

    pool = await get_pool()
    async with pool.acquire() as db:
        pipeline = DocumentPipeline(
            db=db,
            vector_store=vector_store,
            embedding_fn=None,  # Will be set when LLM manager provides embeddings
        )

        for file_path in file_paths:
            try:
                await pipeline.process_file(project_id, file_path)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).error(
                    "Processing failed for %s: %s", file_path, exc
                )
            finally:
                # Clean up temp files to prevent confidential data leakage
                try:
                    if file_path.exists():
                        file_path.unlink()
                    tmp_dir = file_path.parent
                    if tmp_dir.name.startswith("dda_upload_") and tmp_dir.exists():
                        shutil.rmtree(str(tmp_dir), ignore_errors=True)
                except Exception:
                    pass


@router.get("", response_model=list[DocumentListItem])
async def list_documents(
    project_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """List all documents in a project."""
    rows = await db.fetch(
        """SELECT id, filename, mime_type, file_size, status,
                  page_count, ocr_confidence, created_at
           FROM documents
           WHERE project_id = $1
           ORDER BY created_at DESC""",
        project_id,
    )
    return [DocumentListItem(**dict(row)) for row in rows]


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    project_id: str,
    document_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Get full document metadata."""
    row = await db.fetchrow(
        "SELECT * FROM documents WHERE id = $1 AND project_id = $2",
        document_id, project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    data = dict(row)
    data["is_encrypted"] = bool(data.get("is_encrypted", False))
    metadata_raw = data.get("metadata_json", "{}")
    data["metadata_json"] = orjson.loads(metadata_raw) if isinstance(metadata_raw, (str, bytes)) else metadata_raw
    return DocumentResponse(**data)


@router.get("/{document_id}/chunks", response_model=list[ChunkResponse])
async def list_chunks(
    project_id: str,
    document_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """List all text chunks for a document."""
    rows = await db.fetch(
        """SELECT id, document_id, chunk_index, text,
                  page_number, section, token_count
           FROM chunks
           WHERE document_id = $1
           ORDER BY chunk_index""",
        document_id,
    )
    return [ChunkResponse(**dict(row)) for row in rows]


@router.get("/{document_id}/tables", response_model=list[TableResponse])
async def list_tables(
    project_id: str,
    document_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """List all extracted tables for a document."""
    rows = await db.fetch(
        """SELECT id, document_id, table_index, page_number, caption,
                  headers_json, rows_json, row_count, col_count, table_type
           FROM tables_extracted
           WHERE document_id = $1
           ORDER BY table_index""",
        document_id,
    )

    results: list[TableResponse] = []
    for row in rows:
        data = dict(row)
        headers_raw = data["headers_json"]
        rows_raw = data["rows_json"]
        results.append(
            TableResponse(
                id=data["id"],
                document_id=data["document_id"],
                table_index=data["table_index"],
                page_number=data["page_number"],
                caption=data["caption"],
                headers=orjson.loads(headers_raw) if isinstance(headers_raw, (str, bytes)) else headers_raw,
                rows=orjson.loads(rows_raw) if isinstance(rows_raw, (str, bytes)) else rows_raw,
                row_count=data["row_count"],
                col_count=data["col_count"],
                table_type=data["table_type"],
            )
        )
    return results


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    project_id: str,
    document_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Delete a document and all associated data."""
    row = await db.fetchrow(
        "SELECT stored_path FROM documents WHERE id = $1 AND project_id = $2",
        document_id, project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete from database (cascades to chunks, tables_extracted)
    await db.execute("DELETE FROM documents WHERE id = $1", document_id)

    # Delete stored file
    stored = Path(row["stored_path"])
    if stored.exists():
        from app.services.security.encryption import SecureDeleteService
        SecureDeleteService.secure_delete(stored)
