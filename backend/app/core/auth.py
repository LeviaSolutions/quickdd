"""Authentication — re-exports JWT-based auth for route dependencies.

All existing routes use ``_auth: BearerAuth`` as a guard dependency.
This module keeps that interface stable while switching the underlying
mechanism from a static bearer token to JWT-based authentication.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.core.jwt_auth import get_current_user

# Re-usable dependency annotation — drop-in replacement for the old bearer check.
# Routes that declare ``_auth: BearerAuth`` will now receive a dict with
# {"user_id": UUID, "role": str} instead of a plain token string.
BearerAuth = Annotated[dict, Depends(get_current_user)]
