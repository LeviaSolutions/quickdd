"""Project-scoped question & answer API routes.

Serves questions filtered by the project's asset class,
paired with any existing answers for that project.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

logger = logging.getLogger(__name__)

from app.core.auth import BearerAuth
from app.db.postgres import get_db
from app.schemas.questions import (
    AnswerResponse,
    CustomQuestionCreate,
    QuestionAnswerPairResponse,
    QuestionResponse,
)

router = APIRouter(
    prefix="/projects/{project_id}/questions",
    tags=["project-questions"],
)


def _parse_json_field(value: Any) -> Any:
    """Parse a JSON field that may already be a Python object (JSONB) or a string."""
    if isinstance(value, str):
        return json.loads(value)
    return value if value is not None else []


def _extract_short_answer(text: str) -> str:
    """Extract a concise one-line summary from the full answer text.

    If the first line is very short (e.g. just "Ja." or "Nein."), it gets
    combined with the next line so the short answer is informative.
    Source citations like [Dateiname, S. 1] are stripped for brevity.
    """
    if not text:
        return ""

    # Collect non-empty lines
    lines: list[str] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped:
            # Strip leading list markers
            stripped = re.sub(r"^[-*]\s+", "", stripped)
            lines.append(stripped)
        if len(lines) >= 3:
            break

    if not lines:
        return text[:200]

    # Combine first line with next if it's very short (< 30 chars)
    # e.g. "Ja." + "Ein Brandschutzkonzept liegt vor." -> single answer
    result = lines[0]
    if len(result) < 30 and len(lines) > 1:
        result = result + " " + lines[1]

    # Strip source citations [Dateiname, S. N] for the short view
    result = re.sub(r"\s*\[[^\]]{3,80}\]", "", result)

    # Truncate at second sentence end or max 200 chars
    # Find the second sentence boundary
    sentence_ends = list(re.finditer(r"[.!?](?:\s|$)", result))
    if len(sentence_ends) >= 2 and sentence_ends[1].end() <= 200:
        return result[: sentence_ends[1].end()].strip()
    if len(sentence_ends) >= 1 and sentence_ends[0].end() <= 200:
        # If only one sentence and it's within limit, use it
        if sentence_ends[0].end() >= 20:
            return result[: sentence_ends[0].end()].strip()

    if len(result) > 200:
        return result[:197] + "..."
    return result


@router.get("", response_model=list[QuestionAnswerPairResponse])
async def list_project_questions(
    project_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
    category: str | None = None,
    confidence: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    search: str | None = None,
):
    """List all questions applicable to this project's asset class,
    each paired with its answer (if any).
    """
    # Get project's asset class
    row = await db.fetchrow(
        "SELECT asset_class FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    asset_class = row["asset_class"]

    # Check if junction table has entries for this project
    selected_ids: set[str] | None = None
    try:
        pq_rows = await db.fetch(
            "SELECT question_id FROM project_questions WHERE project_id = $1",
            project_id,
        )
        if pq_rows:
            selected_ids = {r["question_id"] for r in pq_rows}
            logger.info(
                "Project %s: junction table has %d entries, filtering by selection",
                project_id, len(selected_ids),
            )
        else:
            logger.info(
                "Project %s: junction table empty, falling back to asset_class=%s",
                project_id, asset_class,
            )
    except Exception as exc:
        logger.warning(
            "Project %s: project_questions table query failed (%s), falling back to asset_class",
            project_id, exc,
        )

    # Fetch all questions
    q_rows = await db.fetch(
        "SELECT * FROM questions ORDER BY category, priority, id"
    )

    # Fetch all answers for this project
    a_rows = await db.fetch(
        "SELECT * FROM answers WHERE project_id = $1",
        project_id,
    )
    answers_by_qid: dict[str, dict[str, Any]] = {
        r["question_id"]: dict(r) for r in a_rows
    }

    results: list[QuestionAnswerPairResponse] = []
    for qrow in q_rows:
        qdata = dict(qrow)
        asset_classes = _parse_json_field(qdata.get("asset_classes_json", []))

        # Filter by junction table if populated, else fall back to asset class
        if selected_ids is not None:
            if qdata["id"] not in selected_ids:
                continue
        else:
            if asset_classes and asset_class not in asset_classes:
                continue

        # Apply optional filters
        if category and qdata["category"] != category:
            continue
        if priority and qdata["priority"] != priority:
            continue

        question = QuestionResponse(
            id=qdata["id"],
            category=qdata["category"],
            subcategory=qdata.get("subcategory"),
            asset_classes=asset_classes,
            question_de=qdata["question_de"],
            question_en=qdata["question_en"],
            expected_format=qdata["expected_format"],
            search_keywords_de=_parse_json_field(qdata.get("search_keywords_de", [])),
            search_keywords_en=_parse_json_field(qdata.get("search_keywords_en", [])),
            priority=qdata["priority"],
            source_hint=qdata.get("source_hint"),
            llm_instruction=qdata.get("llm_instruction"),
            validation_rule=qdata.get("validation_rule"),
            depends_on=_parse_json_field(qdata.get("depends_on_json", [])),
            severity_weight=qdata.get("severity_weight", 5),
            regulatory_reference=qdata.get("regulatory_reference"),
            requires_table_qa=bool(qdata.get("requires_table_qa", False)),
            multi_hop_required=bool(qdata.get("multi_hop_required", False)),
        )

        # Build answer if exists
        answer = None
        adata = answers_by_qid.get(qdata["id"])
        if adata:
            # Apply answer-level filters
            if confidence and adata["confidence_tier"] != confidence:
                continue
            if status and adata["status"] != status:
                continue

            answer = AnswerResponse(
                id=adata["id"],
                project_id=adata["project_id"],
                question_id=adata["question_id"],
                answer_text=adata["answer_text"],
                short_answer=_extract_short_answer(adata["answer_text"]),
                confidence_tier=adata["confidence_tier"],
                confidence_score=adata["confidence_score"],
                retrieval_score=adata.get("retrieval_score"),
                consistency_score=adata.get("consistency_score"),
                hop_count=adata.get("hop_count", 1),
                model_used=adata["model_used"],
                status=adata["status"],
                created_at=adata["created_at"],
                updated_at=adata["updated_at"],
            )
        else:
            # If filtering by confidence or status and no answer, skip
            if confidence or status:
                continue

        # Search filter (match against question text)
        if search:
            search_lower = search.lower()
            if (
                search_lower not in qdata["question_de"].lower()
                and search_lower not in qdata["question_en"].lower()
                and search_lower not in (qdata.get("subcategory") or "").lower()
            ):
                continue

        results.append(
            QuestionAnswerPairResponse(question=question, answer=answer)
        )

    return results


@router.get("/{question_id}", response_model=QuestionAnswerPairResponse)
async def get_project_question(
    project_id: str,
    question_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Get a single question with its answer for this project."""
    # Verify project exists
    row = await db.fetchrow(
        "SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get question
    qrow = await db.fetchrow(
        "SELECT * FROM questions WHERE id = $1", question_id
    )
    if not qrow:
        raise HTTPException(status_code=404, detail="Question not found")

    qdata = dict(qrow)
    question = QuestionResponse(
        id=qdata["id"],
        category=qdata["category"],
        subcategory=qdata.get("subcategory"),
        asset_classes=_parse_json_field(qdata.get("asset_classes_json", [])),
        question_de=qdata["question_de"],
        question_en=qdata["question_en"],
        expected_format=qdata["expected_format"],
        search_keywords_de=_parse_json_field(qdata.get("search_keywords_de", [])),
        search_keywords_en=_parse_json_field(qdata.get("search_keywords_en", [])),
        priority=qdata["priority"],
        source_hint=qdata.get("source_hint"),
        llm_instruction=qdata.get("llm_instruction"),
        validation_rule=qdata.get("validation_rule"),
        depends_on=_parse_json_field(qdata.get("depends_on_json", [])),
        severity_weight=qdata.get("severity_weight", 5),
        regulatory_reference=qdata.get("regulatory_reference"),
        requires_table_qa=bool(qdata.get("requires_table_qa", False)),
        multi_hop_required=bool(qdata.get("multi_hop_required", False)),
    )

    # Get answer if exists
    arow = await db.fetchrow(
        "SELECT * FROM answers WHERE project_id = $1 AND question_id = $2",
        project_id, question_id,
    )
    answer = None
    if arow:
        adata = dict(arow)
        answer = AnswerResponse(
            id=adata["id"],
            project_id=adata["project_id"],
            question_id=adata["question_id"],
            answer_text=adata["answer_text"],
            confidence_tier=adata["confidence_tier"],
            confidence_score=adata["confidence_score"],
            retrieval_score=adata.get("retrieval_score"),
            consistency_score=adata.get("consistency_score"),
            hop_count=adata.get("hop_count", 1),
            model_used=adata["model_used"],
            status=adata["status"],
            created_at=adata["created_at"],
            updated_at=adata["updated_at"],
        )

    return QuestionAnswerPairResponse(question=question, answer=answer)


@router.post(
    "/custom",
    response_model=QuestionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_custom_question(
    project_id: str,
    body: CustomQuestionCreate,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Create a custom question for a project."""
    # Verify project exists
    project_row = await db.fetchrow(
        "SELECT id, asset_class FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not project_row:
        raise HTTPException(status_code=404, detail="Project not found")

    question_id = f"CUSTOM-{uuid.uuid4().hex[:8].upper()}"
    asset_class = project_row["asset_class"]

    # Insert into main questions table so execution engine can use it
    await db.execute(
        """INSERT INTO questions
           (id, category, asset_classes_json, question_de, question_en,
            expected_format, priority)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)""",
        question_id,
        body.category,
        json.dumps([asset_class]),
        body.question_de,
        body.question_en,
        body.expected_format,
        body.priority,
    )

    # Insert into custom_questions for tracking
    await db.execute(
        """INSERT INTO custom_questions
           (id, project_id, category, question_de, question_en,
            expected_format, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
        question_id,
        project_id,
        body.category,
        body.question_de,
        body.question_en,
        body.expected_format,
        body.priority,
    )

    # Add to junction table
    await db.execute(
        "INSERT INTO project_questions (project_id, question_id, is_custom) VALUES ($1, $2, TRUE)",
        project_id, question_id,
    )

    # Update project question count
    await db.execute(
        """UPDATE projects SET
              question_count = (SELECT COUNT(*) FROM project_questions WHERE project_id = $1),
              updated_at = now()
           WHERE id = $1""",
        project_id,
    )

    return QuestionResponse(
        id=question_id,
        category=body.category,
        subcategory=None,
        asset_classes=[asset_class],
        question_de=body.question_de,
        question_en=body.question_en,
        expected_format=body.expected_format,
        search_keywords_de=[],
        search_keywords_en=[],
        priority=body.priority,
        source_hint=None,
        llm_instruction=None,
        validation_rule=None,
        depends_on=[],
        severity_weight=5,
        regulatory_reference=None,
        requires_table_qa=False,
        multi_hop_required=False,
    )
