"""Async SQLite database session management."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncGenerator

import aiosqlite

from app.core.config import settings

logger = logging.getLogger(__name__)

# Module-level connection pool (single writer, multiple readers pattern)
_db: aiosqlite.Connection | None = None


async def init_db() -> None:
    """Open the database and apply the schema idempotently."""
    global _db

    db_path = settings.db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)

    _db = await aiosqlite.connect(str(db_path))
    _db.row_factory = aiosqlite.Row

    # Apply schema
    schema_path = Path(__file__).parent / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    # Split on semicolons and execute each statement.
    # aiosqlite.executescript does not support WAL pragma well,
    # so we execute statements individually.
    for statement in schema_sql.split(";"):
        stmt = statement.strip()
        if stmt:
            try:
                await _db.execute(stmt)
            except Exception as exc:
                # Log but continue — some pragmas may fail on re-run
                logger.debug("Schema statement note: %s — %s", exc, stmt[:80])

    await _db.commit()

    # Runtime migrations for tables that may not exist in older databases
    _migrations = [
        """CREATE TABLE IF NOT EXISTS project_questions (
            project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            is_custom   INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project_id, question_id)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_pq_project ON project_questions(project_id)",
        """CREATE TABLE IF NOT EXISTS custom_questions (
            id              TEXT PRIMARY KEY,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            category        TEXT NOT NULL,
            question_de     TEXT NOT NULL,
            question_en     TEXT NOT NULL DEFAULT '',
            expected_format TEXT NOT NULL DEFAULT 'free_text',
            priority        TEXT NOT NULL DEFAULT 'medium',
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )""",
    ]
    for migration in _migrations:
        try:
            await _db.execute(migration)
        except Exception as exc:
            logger.debug("Migration note: %s — %s", exc, migration[:80])
    await _db.commit()

    # FTS5 triggers — schema.sql splitting on ";" breaks trigger bodies
    # that contain semicolons inside BEGIN...END, so we create them here.
    _triggers = [
        """CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
            INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
        END""",
        """CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        END""",
        """CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
            INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
        END""",
    ]
    for trigger_sql in _triggers:
        try:
            await _db.execute(trigger_sql)
        except Exception as exc:
            logger.debug("Trigger note: %s — %s", exc, trigger_sql[:80])
    await _db.commit()

    # Rebuild FTS5 index to ensure it's in sync with the chunks table
    try:
        await _db.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
        await _db.commit()
        logger.info("FTS5 index rebuilt successfully")
    except Exception as exc:
        logger.warning("FTS5 rebuild failed: %s", exc)

    logger.info("Database schema applied: %s", db_path)


async def close_db() -> None:
    """Close the database connection."""
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency that yields the database connection."""
    if _db is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    yield _db
