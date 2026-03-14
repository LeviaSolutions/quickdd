"""Audit log API routes."""

from __future__ import annotations

from typing import Annotated, Any

import asyncpg
import orjson
from fastapi import APIRouter, Depends

from app.core.auth import BearerAuth
from app.db.postgres import get_db

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit_entries(
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
    project_id: str | None = None,
    action: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    """List audit log entries with optional filtering."""
    query = "SELECT * FROM audit_log"
    conditions: list[str] = []
    params: list[Any] = []
    param_idx = 1

    if project_id:
        conditions.append(f"project_id = ${param_idx}")
        params.append(project_id)
        param_idx += 1
    if action:
        conditions.append(f"action LIKE ${param_idx}")
        params.append(f"%{action}%")
        param_idx += 1

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += f" ORDER BY timestamp DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
    params.extend([limit, offset])

    rows = await db.fetch(query, *params)

    entries = []
    for row in rows:
        data = dict(row)
        details_raw = data.get("details", "{}")
        data["details"] = orjson.loads(details_raw) if isinstance(details_raw, (str, bytes)) else details_raw
        entries.append(data)

    return {"entries": entries, "limit": limit, "offset": offset}
