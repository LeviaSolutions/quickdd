"""Operation token verification for signed IPC between Rust and Python.

The Tauri Rust process generates a cryptographically random operation token
and passes it to the Python backend via the DDA_OPERATION_TOKEN environment
variable.  All requests from the frontend must include this token in the
X-Operation-Token header.  This prevents standalone execution of the Python
sidecar outside of the Tauri wrapper.

In development mode (DDA_DEV=1) or when no token is configured, the check
is skipped so local development works without the Tauri host.
"""

from __future__ import annotations

import hmac
import os

from fastapi import HTTPException, Request

_dev_mode: bool = os.environ.get("DDA_DEV", "1") == "1"
_expected_token: str = os.environ.get("DDA_OPERATION_TOKEN", "")


async def verify_operation_token(request: Request) -> None:
    """Raise 403 if the request does not carry a valid operation token.

    Skipped when running in dev mode or when no expected token is set
    (i.e. the backend was started outside of Tauri).
    """
    if _dev_mode:
        return
    if not _expected_token:
        return

    token = request.headers.get("X-Operation-Token", "")
    if not hmac.compare_digest(token, _expected_token):
        raise HTTPException(status_code=403, detail="Invalid operation token")
