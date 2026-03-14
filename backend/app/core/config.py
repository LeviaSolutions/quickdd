"""Application configuration via environment variables and defaults."""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from pydantic_settings import BaseSettings


def _default_bundle_dir() -> Path:
    """Resolve the directory containing bundled read-only data.

    PyInstaller --onefile extracts data to sys._MEIPASS.
    In development this is the repo backend/ root.
    """
    import sys

    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)))
    return Path(__file__).resolve().parents[2]


def _default_data_dir() -> Path:
    """Resolve the writable runtime data directory.

    When launched by Tauri, cwd is set to app_data_dir.
    In development this equals the bundle dir (repo backend/ root).
    """
    import sys

    if getattr(sys, "frozen", False):
        return Path.cwd()
    return Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Central configuration.  Values can be overridden via env vars
    prefixed with ``DDA_`` (e.g. ``DDA_HOST=0.0.0.0``).
    """

    model_config = {"env_prefix": "DDA_", "env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    # ---- Server / IPC ----
    host: str = "127.0.0.1"
    port: int = 8000  # Fixed port for dev; Tauri prod uses 0 (ephemeral)
    bearer_token: str = os.environ.get("DDA_BEARER_TOKEN", "dev-token-quickdd")
    shutdown_timeout: float = 10.0  # seconds
    health_check_interval: int = 5  # seconds

    # ---- Paths ----
    # bundle_dir: read-only bundled data (questions, templates, models)
    # data_dir:   writable runtime data (database, projects, logs)
    bundle_dir: Path = _default_bundle_dir()
    data_dir: Path = _default_data_dir()

    # Keep app_dir as alias for backwards compat
    @property
    def app_dir(self) -> Path:
        return self.data_dir

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def questions_dir(self) -> Path:
        return self.bundle_dir / "questions"

    @property
    def templates_dir(self) -> Path:
        return self.bundle_dir / "templates"

    @property
    def calibration_dir(self) -> Path:
        return self.bundle_dir / "calibration"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    # ---- Database ----
    database_url: str = "postgresql://ddanalyst:ddanalyst@localhost:5432/ddanalyst"

    # ---- Authentication (JWT) ----
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_ttl_minutes: int = 60
    jwt_refresh_token_ttl_days: int = 7

    # ---- LLM ----
    llm_provider: str = "openai"  # "openai" or "anthropic"
    # OpenAI-compatible (ollama, vLLM, etc.)
    openai_base_url: str = "http://localhost:11434/v1"
    openai_api_key: str = "ollama"
    openai_model: str = "llama4:scout"
    # Anthropic (fallback for development)
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-20250514"
    # Shared
    context_window: int = 131_072
    temperature: float = 0.1
    top_p: float = 0.9
    max_output_tokens: int = 4_096

    # ---- Chunking ----
    chunk_size_tokens: int = 512
    chunk_overlap_tokens: int = 64

    # ---- RAG ----
    retrieval_top_k: int = 20
    rerank_top_n: int = 8
    max_hop_depth: int = 3
    question_batch_size: int = 4

    # ---- Confidence Calibration ----
    confidence_high_threshold: float = 0.85
    confidence_medium_threshold: float = 0.70
    confidence_low_threshold: float = 0.50

    # ---- Security ----
    encryption_iterations: int = 600_000
    secure_delete_passes: int = 3

    # ---- Logging ----
    log_level: str = "INFO"


# Singleton instance — import ``settings`` everywhere.
settings = Settings()
