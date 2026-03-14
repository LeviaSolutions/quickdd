"""Application lifecycle events — startup and shutdown hooks."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import bcrypt
from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import setup_logging
from app.db.postgres import close_db, get_pool, init_db
from app.services.llm.manager import LLMManager
from app.services.processing.vector_store import VectorStoreManager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI lifespan context — runs on startup and shutdown."""

    # ---- STARTUP ----
    setup_logging()
    logger.info("DD-Analyst backend starting up")

    # Ensure required directories exist
    for directory in (
        settings.projects_dir,
        settings.questions_dir,
        settings.templates_dir,
        settings.calibration_dir,
        settings.logs_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    # Initialize PostgreSQL database
    await init_db()
    logger.info("PostgreSQL database initialized")

    # Seed default admin user if no users exist
    pool = await get_pool()
    async with pool.acquire() as conn:
        user_count = await conn.fetchval("SELECT COUNT(*) FROM users")
        if user_count == 0:
            password_hash = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
            await conn.execute(
                "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)",
                "admin@ddanalyst.local",
                "Administrator",
                password_hash,
                "admin",
            )
            logger.info("Seeded default admin user: admin@ddanalyst.local / admin")

    # Load question catalogue if empty
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT count(*) FROM questions")
        if count == 0:
            from app.services.questions import QuestionCatalogueService
            service = QuestionCatalogueService(conn)
            loaded = await service.load_catalogue("de")
            logger.info("Loaded %d questions from catalogue", loaded)
        else:
            logger.info("Question catalogue already loaded (%d questions)", count)

    # Initialize vector store manager (ChromaDB)
    app.state.vector_store = VectorStoreManager()
    logger.info("Vector store manager ready")

    # Initialize LLM manager (deferred model loading)
    app.state.llm_manager = LLMManager()
    logger.info("LLM manager instantiated (models load on first use)")

    logger.info("Startup complete")

    yield

    # ---- SHUTDOWN ----
    logger.info("DD-Analyst backend shutting down")

    # Clean up LLM manager
    if hasattr(app.state, "llm_manager"):
        await app.state.llm_manager.unload()
        logger.info("LLM manager shut down")

    # Close database connections
    await close_db()
    logger.info("Database connections closed")

    logger.info("Shutdown complete")
