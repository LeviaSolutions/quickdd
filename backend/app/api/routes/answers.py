"""Answer management API routes — storage, overrides, signoffs."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import BearerAuth
from app.db.postgres import get_db
from app.schemas.answers import (
    AnswerListItem,
    AnswerResponse,
    AnswerSourceResponse,
    ContradictionResolve,
    ContradictionResponse,
    OverrideCreate,
    OverrideResponse,
    ReviewSignoffCreate,
    ReviewSignoffResponse,
)

router = APIRouter(
    prefix="/projects/{project_id}/answers", tags=["answers"]
)


@router.get("", response_model=list[AnswerListItem])
async def list_answers(
    project_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
    category: str | None = None,
    confidence_tier: str | None = None,
    answer_status: str | None = None,
):
    """List all answers for a project with optional filters."""
    query = """
        SELECT a.id, a.question_id, a.answer_text, a.confidence_tier,
               a.confidence_score, a.status, a.hop_count,
               (SELECT COUNT(*) FROM answer_sources WHERE answer_id = a.id) as source_count,
               (SELECT COUNT(*) FROM contradictions WHERE answer_id = a.id AND resolved = FALSE) > 0 as has_contradictions,
               (SELECT COUNT(*) FROM overrides WHERE answer_id = a.id) > 0 as has_override,
               (SELECT COUNT(*) FROM review_signoffs WHERE answer_id = a.id) > 0 as has_signoff
        FROM answers a
        JOIN questions q ON a.question_id = q.id
        WHERE a.project_id = $1
    """
    params: list[Any] = [project_id]
    param_idx = 2

    if category:
        query += f" AND q.category = ${param_idx}"
        params.append(category)
        param_idx += 1
    if confidence_tier:
        query += f" AND a.confidence_tier = ${param_idx}"
        params.append(confidence_tier)
        param_idx += 1
    if answer_status:
        query += f" AND a.status = ${param_idx}"
        params.append(answer_status)
        param_idx += 1

    query += " ORDER BY q.category, q.priority, q.id"

    rows = await db.fetch(query, *params)

    return [
        AnswerListItem(
            id=r["id"],
            question_id=r["question_id"],
            answer_text=r["answer_text"],
            confidence_tier=r["confidence_tier"],
            confidence_score=r["confidence_score"],
            status=r["status"],
            hop_count=r["hop_count"],
            source_count=r["source_count"],
            has_contradictions=bool(r["has_contradictions"]),
            has_override=bool(r["has_override"]),
            has_signoff=bool(r["has_signoff"]),
        )
        for r in rows
    ]


@router.get("/{answer_id}", response_model=AnswerResponse)
async def get_answer(
    project_id: str,
    answer_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Get a full answer with sources, contradictions, and overrides."""
    row = await db.fetchrow(
        "SELECT * FROM answers WHERE id = $1 AND project_id = $2",
        answer_id, project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Answer not found")

    answer = dict(row)

    # Fetch sources
    src_rows = await db.fetch(
        """SELECT s.*, c.text as chunk_text, c.page_number as chunk_page,
                  d.filename as doc_filename
           FROM answer_sources s
           LEFT JOIN chunks c ON s.chunk_id = c.id
           LEFT JOIN documents d ON c.document_id = d.id
           WHERE s.answer_id = $1
           ORDER BY s.rank_position""",
        answer_id,
    )
    sources = [
        AnswerSourceResponse(
            id=s["id"],
            chunk_id=s["chunk_id"],
            table_id=s["table_id"],
            relevance_score=s["relevance_score"],
            rank_position=s["rank_position"],
            document_filename=s.get("doc_filename"),
            page_number=s.get("chunk_page"),
            text_preview=(s.get("chunk_text", "") or "")[:200],
        )
        for s in src_rows
    ]

    # Fetch contradictions
    contr_rows = await db.fetch(
        "SELECT * FROM contradictions WHERE answer_id = $1", answer_id
    )
    contradictions = [
        ContradictionResponse(**dict(c))
        for c in contr_rows
    ]

    # Fetch latest override
    ovr_row = await db.fetchrow(
        "SELECT * FROM overrides WHERE answer_id = $1 ORDER BY created_at DESC LIMIT 1",
        answer_id,
    )
    override = OverrideResponse(**dict(ovr_row)) if ovr_row else None

    # Fetch signoff
    sig_row = await db.fetchrow(
        "SELECT * FROM review_signoffs WHERE answer_id = $1 LIMIT 1",
        answer_id,
    )
    signoff = ReviewSignoffResponse(**dict(sig_row)) if sig_row else None

    return AnswerResponse(
        **answer,
        sources=sources,
        contradictions=contradictions,
        override=override,
        review_signoff=signoff,
    )


@router.post("/{answer_id}/override", response_model=OverrideResponse)
async def create_override(
    project_id: str,
    answer_id: str,
    body: OverrideCreate,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Manually override an AI-generated answer."""
    # Verify answer exists
    row = await db.fetchrow(
        "SELECT id FROM answers WHERE id = $1 AND project_id = $2",
        answer_id, project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Answer not found")

    override_id = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO overrides (id, answer_id, override_text, user_name, reason)
           VALUES ($1, $2, $3, $4, $5)""",
        override_id, answer_id, body.override_text, body.user_name, body.reason,
    )

    # Update answer status
    await db.execute(
        "UPDATE answers SET status = 'overridden', updated_at = now() WHERE id = $1",
        answer_id,
    )

    # Audit log
    from app.services.security.encryption import AuditLogger
    audit = AuditLogger(db)
    await audit.log(
        "answer.override",
        project_id=project_id,
        entity_type="answer",
        entity_id=answer_id,
        details={"user": body.user_name, "reason": body.reason},
        user_name=body.user_name,
    )

    return OverrideResponse(
        id=override_id,
        answer_id=answer_id,
        override_text=body.override_text,
        user_name=body.user_name,
        reason=body.reason,
        created_at=__import__("datetime").datetime.utcnow(),
    )


@router.post("/{answer_id}/signoff", response_model=ReviewSignoffResponse)
async def create_signoff(
    project_id: str,
    answer_id: str,
    body: ReviewSignoffCreate,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Sign off on a critical-priority answer after manual review."""
    row = await db.fetchrow(
        "SELECT id FROM answers WHERE id = $1 AND project_id = $2",
        answer_id, project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Answer not found")

    signoff_id = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO review_signoffs (id, answer_id, reviewer_name, comment)
           VALUES ($1, $2, $3, $4)""",
        signoff_id, answer_id, body.reviewer_name, body.comment,
    )

    await db.execute(
        "UPDATE answers SET status = 'reviewed', updated_at = now() WHERE id = $1",
        answer_id,
    )

    return ReviewSignoffResponse(
        id=signoff_id,
        answer_id=answer_id,
        reviewer_name=body.reviewer_name,
        signed_off_at=__import__("datetime").datetime.utcnow(),
        comment=body.comment,
    )


@router.post("/{answer_id}/contradictions/{contradiction_id}/resolve")
async def resolve_contradiction(
    project_id: str,
    answer_id: str,
    contradiction_id: str,
    body: ContradictionResolve,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Mark a contradiction as resolved."""
    await db.execute(
        """UPDATE contradictions
           SET resolved = TRUE, resolved_by = $1, resolution_note = $2,
               resolved_at = now()
           WHERE id = $3 AND answer_id = $4""",
        body.resolved_by, body.resolution_note, contradiction_id, answer_id,
    )
    return {"status": "resolved"}
