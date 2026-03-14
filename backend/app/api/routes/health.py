"""Health check and system status endpoints."""

from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app import __version__
from app.schemas.common import HealthResponse

router = APIRouter(tags=["system"])

_start_time = time.monotonic()


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request):
    """Unauthenticated health check — used by Tauri for liveness probing."""
    api_connected = False

    if hasattr(request.app.state, "llm_manager"):
        mgr = request.app.state.llm_manager
        api_connected = mgr.is_loaded

    return HealthResponse(
        status="ok",
        version=__version__,
        uptime_seconds=round(time.monotonic() - _start_time, 2),
        database="connected",
        api_connected=api_connected,
    )


@router.post("/shutdown")
async def shutdown(request: Request):
    """Graceful shutdown endpoint — called by Tauri on app close."""
    import asyncio
    import signal
    import os

    # Schedule shutdown after response is sent
    asyncio.get_event_loop().call_later(
        0.5, lambda: os.kill(os.getpid(), signal.SIGTERM)
    )
    return {"status": "shutting_down"}
