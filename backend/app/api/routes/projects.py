"""Project CRUD API routes."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

logger = logging.getLogger(__name__)

from app.core.auth import BearerAuth
from app.db.postgres import get_db
from app.schemas.projects import (
    ProjectCreate,
    ProjectResponse,
    ProjectSummary,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    body: ProjectCreate,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Create a new DD project with asset class selection."""
    project_id = str(uuid.uuid4())
    created_by = _auth.get("user_id") if isinstance(_auth, dict) else None

    await db.execute(
        """INSERT INTO projects (id, name, description, asset_class, language, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        project_id,
        body.name,
        body.description,
        body.asset_class.value,
        body.language,
        created_by,
    )

    # Populate project_questions junction table
    import json as _json
    ac_val = body.asset_class.value

    _qcids_info = f"{len(body.question_catalogue_ids)} IDs" if body.question_catalogue_ids is not None else "None (all)"
    logger.info("Creating project %s: question_catalogue_ids=%s", project_id, _qcids_info)

    if body.question_catalogue_ids is not None:
        # Use the explicitly selected question IDs
        for qid in body.question_catalogue_ids:
            try:
                await db.execute(
                    "INSERT INTO project_questions (project_id, question_id) VALUES ($1, $2)",
                    project_id, qid,
                )
            except Exception as exc:
                logger.warning("Failed to insert project_question %s/%s: %s", project_id, qid, exc)
    else:
        # Default: insert ALL questions matching the asset class
        q_rows = await db.fetch("SELECT id, asset_classes_json FROM questions")
        for row in q_rows:
            ac_list = _json.loads(row["asset_classes_json"]) if isinstance(row["asset_classes_json"], str) else row["asset_classes_json"]
            if ac_val in ac_list or not ac_list:
                try:
                    await db.execute(
                        "INSERT INTO project_questions (project_id, question_id) VALUES ($1, $2)",
                        project_id, row["id"],
                    )
                except Exception as exc:
                    logger.warning("Failed to insert project_question %s/%s: %s", project_id, row["id"], exc)

    # Count actual inserted rows — this is the source of truth
    q_count = await db.fetchval(
        "SELECT COUNT(*) FROM project_questions WHERE project_id = $1",
        project_id,
    )
    logger.info("Project %s: %d questions actually inserted into junction table", project_id, q_count)

    await db.execute(
        "UPDATE projects SET question_count = $1 WHERE id = $2",
        q_count, project_id,
    )

    # Create project directory structure
    from app.core.config import settings
    for subdir in ("original", "extracted", "tables", "chroma", "exports"):
        (settings.projects_dir / project_id / subdir).mkdir(
            parents=True, exist_ok=True
        )

    try:
        result = await _get_project_or_404(db, project_id)
        logger.info("Project %s created successfully, returning response", project_id)
        return result
    except Exception as exc:
        import traceback
        logger.error("Failed to return project %s: %s\n%s", project_id, exc, traceback.format_exc())
        raise


@router.get("", response_model=list[ProjectSummary])
async def list_projects(
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """List all active projects."""
    rows = await db.fetch(
        """SELECT id, name, description, asset_class, status, file_count,
                  question_count, answered_count, created_at, updated_at
           FROM projects
           WHERE deleted_at IS NULL
           ORDER BY created_at DESC"""
    )
    results = []
    for row in rows:
        data = dict(row)
        q_count = data.get("question_count", 0) or 0
        a_count = data.get("answered_count", 0) or 0
        data["coverage_percentage"] = (a_count / q_count * 100) if q_count > 0 else 0.0
        data["red_flag_count"] = 0  # TODO: compute from answers table
        results.append(ProjectSummary(**data))
    return results


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Get a single project by ID."""
    return await _get_project_or_404(db, project_id)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Update project metadata."""
    # Verify project exists
    await _get_project_or_404(db, project_id)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    # Allowlist of updatable fields to prevent SQL injection
    ALLOWED_FIELDS = {"name", "description", "asset_class", "status", "language"}

    set_clauses: list[str] = []
    params: list = []
    param_idx = 1
    for field_name, value in updates.items():
        if field_name not in ALLOWED_FIELDS:
            continue
        if hasattr(value, "value"):
            value = value.value
        set_clauses.append(f"{field_name} = ${param_idx}")
        params.append(value)
        param_idx += 1

    if not set_clauses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid fields to update",
        )

    set_clauses.append("updated_at = now()")
    params.append(project_id)

    await db.execute(
        f"UPDATE projects SET {', '.join(set_clauses)} WHERE id = ${param_idx}",
        *params,
    )

    return await _get_project_or_404(db, project_id)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
    secure: bool = True,
):
    """Delete a project.  If ``secure=True``, files are securely wiped."""
    await _get_project_or_404(db, project_id)

    # Soft-delete in database
    await db.execute(
        """UPDATE projects
           SET deleted_at = now(),
               status = 'archived'
           WHERE id = $1""",
        project_id,
    )

    # Securely delete project files
    from app.core.config import settings
    from app.services.security.encryption import SecureDeleteService

    project_dir = settings.projects_dir / project_id
    if project_dir.exists():
        if secure:
            SecureDeleteService.secure_delete_directory(project_dir)
        else:
            import shutil
            shutil.rmtree(str(project_dir), ignore_errors=True)


# ---- Helpers ----

async def _get_project_or_404(
    db: asyncpg.Connection, project_id: str
) -> ProjectResponse:
    row = await db.fetchrow(
        "SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found",
        )
    return ProjectResponse(**dict(row))
