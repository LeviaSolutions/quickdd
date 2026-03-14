"""Report generation API routes."""

from __future__ import annotations

import uuid
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.core.auth import BearerAuth
from app.db.postgres import get_db
from app.schemas.reports import ReportGenerateRequest, ReportResponse

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("", response_model=ReportResponse)
async def generate_report(
    body: ReportGenerateRequest,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Generate a DD report."""
    from app.services.reports.generator import ReportGenerator

    generator = ReportGenerator(db)

    try:
        output_path = await generator.generate(
            project_id=body.project_id,
            report_type=body.report_type,
            output_format=body.format,
            branding=body.branding,
            category_filter=body.category_filter,
            language=body.language,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Report generation failed: {exc}",
        )

    return ReportResponse(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        report_type=body.report_type,
        format=body.format,
        filename=output_path.name,
        file_size=output_path.stat().st_size,
        download_path=str(output_path),
        created_at=__import__("datetime").datetime.utcnow().isoformat(),
    )


@router.get("/download")
async def download_report(
    path: str,
    _auth: BearerAuth,
):
    """Download a generated report file."""
    from pathlib import Path

    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Report file not found")

    # Security: verify the path is within projects directory
    from app.core.config import settings
    try:
        file_path.resolve().relative_to(settings.projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    media_types = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type=media_types.get(file_path.suffix, "application/octet-stream"),
    )
