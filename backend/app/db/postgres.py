"""Async PostgreSQL database connection pool using asyncpg."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncGenerator

import asyncpg

from app.core.config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_db() -> None:
    """Create the connection pool and apply the schema idempotently."""
    global _pool

    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=2,
        max_size=10,
    )

    schema_path = Path(__file__).parent / "schema_pg.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    async with _pool.acquire() as conn:
        await conn.execute(schema_sql)

    logger.info("PostgreSQL schema applied: %s", settings.database_url)


async def close_db() -> None:
    """Close the connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def get_pool() -> asyncpg.Pool:
    """Return the raw pool (used by startup code that needs a connection)."""
    if _pool is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    return _pool


async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """FastAPI dependency that yields a connection from the pool."""
    if _pool is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    async with _pool.acquire() as conn:
        yield conn
