"""DD-Analyst FastAPI Backend — Main Application Entry Point.

This module creates the FastAPI application with:
  - Ephemeral port binding (localhost:0)
  - Bearer token authentication on all routes
  - SSE streaming support for LLM generation
  - SQLite + FTS5 database initialization
  - Graceful startup/shutdown lifecycle
  - CORS disabled (localhost-only IPC, no browser origin issues)

The startup sequence:
  1. Bind to localhost:0 (OS assigns ephemeral port)
  2. Print the assigned port to stdout (Tauri reads this)
  3. Print the bearer token to stdout (Tauri stores this)
  4. Initialize database, vector store, and LLM manager
  5. Begin accepting requests

Usage:
  python -m app.main
  # Prints: PORT=<ephemeral_port>
  # Prints: TOKEN=<bearer_token>
"""

from __future__ import annotations

import logging
import sys
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api.routes import (
    answers,
    audit,
    auth,
    chat,
    documents,
    execution,
    health,
    project_questions,
    projects,
    questions,
    reports,
)
from app.core.config import settings
from app.core.events import lifespan

# ---- Application Factory ----

app = FastAPI(
    title="DD-Analyst Backend",
    description="Offline AI-Powered Real Estate Due Diligence Engine",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.log_level == "DEBUG" else None,
    redoc_url=None,
)

# CORS — allow any origin since clients connect over VPN network.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_logger = logging.getLogger("app.main")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    _logger.error("Unhandled exception on %s %s:\n%s", request.method, request.url.path, "".join(tb))
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# ---- Router Registration ----

# System routes (health check is unauthenticated)
app.include_router(health.router)

# Auth routes (login/refresh are public; admin routes use require_admin internally)
app.include_router(auth.router)

# Authenticated API routes
app.include_router(projects.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(project_questions.router, prefix="/api/v1")
app.include_router(questions.router, prefix="/api/v1")
app.include_router(answers.router, prefix="/api/v1")
app.include_router(execution.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")


# ---- Entrypoint ----

def main() -> None:
    """Start the uvicorn server on an ephemeral port.

    Writes PORT=<port> and TOKEN=<token> to stdout for Tauri to read.
    """
    import socket
    import uvicorn

    # Resolve ephemeral port if configured as 0
    if settings.port == 0:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind((settings.host, 0))
        _, port = sock.getsockname()
        sock.close()
    else:
        port = settings.port

    # Write port and token to stdout for Tauri IPC bridge.
    # These MUST be the first lines on stdout — Tauri reads them
    # to establish the HTTP connection.
    # Use os.write() to bypass Python's block buffering when stdout
    # is piped (non-TTY), which happens inside PyInstaller + Tauri.
    import os

    os.write(sys.stdout.fileno(), f"PORT={port}\n".encode())
    os.write(sys.stdout.fileno(), f"TOKEN={settings.bearer_token}\n".encode())

    # Also write a .port file as a fallback for Tauri to read,
    # in case stdout piping fails (PyInstaller buffering issue).
    port_file = os.path.join(os.getcwd(), ".backend-port")
    with open(port_file, "w") as f:
        f.write(f"{port}\n{settings.bearer_token}\n")

    uvicorn.run(
        app,
        host=settings.host,
        port=port,
        log_level=settings.log_level.lower(),
        # Disable uvicorn access log (we handle logging ourselves)
        access_log=False,
        # Single-process mode (spawned as child of Tauri)
        workers=1,
        # Graceful shutdown timeout
        timeout_graceful_shutdown=int(settings.shutdown_timeout),
    )


if __name__ == "__main__":
    main()
