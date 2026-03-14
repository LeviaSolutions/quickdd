"""Question catalogue and execution API routes."""

from __future__ import annotations

import json
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.auth import BearerAuth
from app.db.postgres import get_db
from app.schemas.common import AssetClass, Priority
from app.schemas.questions import (
    QuestionExecutionRequest,
    QuestionFilter,
    QuestionResponse,
)

router = APIRouter(prefix="/questions", tags=["questions"])


def _parse_json_field(value: Any) -> Any:
    """Parse a JSON field that may already be a Python object (JSONB) or a string."""
    if isinstance(value, str):
        return json.loads(value)
    return value if value is not None else []


@router.get("", response_model=list[QuestionResponse])
async def list_questions(
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
    category: str | None = None,
    asset_class: AssetClass | None = None,
    priority: Priority | None = None,
):
    """List questions from the catalogue with optional filtering."""
    query = "SELECT * FROM questions"
    conditions: list[str] = []
    params: list[Any] = []
    param_idx = 1

    if category:
        conditions.append(f"category = ${param_idx}")
        params.append(category)
        param_idx += 1
    if priority:
        conditions.append(f"priority = ${param_idx}")
        params.append(priority.value)
        param_idx += 1

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY category, priority, id"

    rows = await db.fetch(query, *params)

    results: list[QuestionResponse] = []
    for row in rows:
        data = dict(row)
        asset_classes = _parse_json_field(data.get("asset_classes_json", []))

        # Filter by asset class in Python (JSON field)
        if asset_class and asset_class.value not in asset_classes:
            continue

        results.append(
            QuestionResponse(
                id=data["id"],
                category=data["category"],
                subcategory=data.get("subcategory"),
                asset_classes=asset_classes,
                question_de=data["question_de"],
                question_en=data["question_en"],
                expected_format=data["expected_format"],
                search_keywords_de=_parse_json_field(
                    data.get("search_keywords_de", [])
                ),
                search_keywords_en=_parse_json_field(
                    data.get("search_keywords_en", [])
                ),
                priority=data["priority"],
                source_hint=data.get("source_hint"),
                llm_instruction=data.get("llm_instruction"),
                validation_rule=data.get("validation_rule"),
                depends_on=_parse_json_field(data.get("depends_on_json", [])),
                severity_weight=data.get("severity_weight", 5),
                regulatory_reference=data.get("regulatory_reference"),
                requires_table_qa=bool(data.get("requires_table_qa", False)),
                multi_hop_required=bool(data.get("multi_hop_required", False)),
            )
        )

    return results


@router.get("/{question_id}", response_model=QuestionResponse)
async def get_question(
    question_id: str,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Get a single question by ID."""
    row = await db.fetchrow(
        "SELECT * FROM questions WHERE id = $1", question_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")

    data = dict(row)
    return QuestionResponse(
        id=data["id"],
        category=data["category"],
        subcategory=data.get("subcategory"),
        asset_classes=_parse_json_field(data.get("asset_classes_json", [])),
        question_de=data["question_de"],
        question_en=data["question_en"],
        expected_format=data["expected_format"],
        search_keywords_de=_parse_json_field(data.get("search_keywords_de", [])),
        search_keywords_en=_parse_json_field(data.get("search_keywords_en", [])),
        priority=data["priority"],
        source_hint=data.get("source_hint"),
        llm_instruction=data.get("llm_instruction"),
        validation_rule=data.get("validation_rule"),
        depends_on=_parse_json_field(data.get("depends_on_json", [])),
        severity_weight=data.get("severity_weight", 5),
        regulatory_reference=data.get("regulatory_reference"),
        requires_table_qa=bool(data.get("requires_table_qa", False)),
        multi_hop_required=bool(data.get("multi_hop_required", False)),
    )


@router.post("/load-catalogue")
async def load_catalogue(
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
    language: str = "de",
):
    """Load the question catalogue from JSON files into the database."""
    from app.services.questions import QuestionCatalogueService

    service = QuestionCatalogueService(db)
    count = await service.load_catalogue(language)
    return {"loaded": count, "language": language}


@router.get("/categories/list")
async def list_categories(
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """List all distinct question categories."""
    rows = await db.fetch(
        "SELECT DISTINCT category FROM questions ORDER BY category"
    )
    return [row["category"] for row in rows]
