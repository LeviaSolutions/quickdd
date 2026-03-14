"""Structured logging configuration."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from app.core.config import settings


def setup_logging() -> None:
    """Configure root logger with file + stderr handlers."""

    log_dir: Path = settings.logs_dir
    log_dir.mkdir(parents=True, exist_ok=True)

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    # File handler — rotating would be better for prod, but stdlib is fine
    file_handler = logging.FileHandler(
        log_dir / "backend.log", encoding="utf-8"
    )
    file_handler.setFormatter(fmt)

    # Stderr handler — Tauri reads stderr for diagnostics
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(settings.log_level)
    root.addHandler(file_handler)
    root.addHandler(stderr_handler)

    # Quiet noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("chromadb").setLevel(logging.WARNING)
