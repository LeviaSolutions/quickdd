"""License JWT verification for the Python backend.

Verifies Ed25519-signed license JWTs sent from the Tauri frontend.
In dev mode (DDA_DEV=1), all verification is skipped and mock success
is returned.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

_dev_mode = os.environ.get("DDA_DEV", "1") == "1"

_LICENSE_ISSUER = "dd-analyst-license-server"
_LICENSE_ALGORITHM = "EdDSA"

_LICENSE_API_URL = os.environ.get(
    "LICENSE_API_URL",
    "https://us-central1-dd-analyst-prod.cloudfunctions.net",
)

# Cache the public key after first load
_public_key_cache: str | None = None


def _load_public_key() -> str:
    """Load the Ed25519 public key from the bundle directory.

    Returns the PEM-encoded public key string.
    Raises FileNotFoundError if the key file is missing.
    """
    global _public_key_cache
    if _public_key_cache is not None:
        return _public_key_cache

    key_path: Path = settings.bundle_dir / "keys" / "license-public.pem"
    if not key_path.exists():
        raise FileNotFoundError(
            f"License public key not found at {key_path}. "
            "Ensure the key file is bundled correctly."
        )

    _public_key_cache = key_path.read_text(encoding="utf-8")
    return _public_key_cache


def verify_license_jwt(token: str) -> dict:
    """Verify an Ed25519-signed license JWT.

    Parameters
    ----------
    token:
        The raw JWT string from the ``X-License-Token`` header.

    Returns
    -------
    dict
        The decoded claims from the JWT.

    Raises
    ------
    ValueError
        If the token is invalid, expired, or has a bad signature.
    """
    if _dev_mode:
        logger.debug("Dev mode: skipping license JWT verification")
        return {
            "sub": "dev-user",
            "key": "dev-license-key",
            "deviceId": "dev-device",
            "tier": "pro",
            "maxScenarios": 999,
            "iss": _LICENSE_ISSUER,
        }

    public_key = _load_public_key()

    try:
        decoded = jwt.decode(
            token,
            public_key,
            algorithms=[_LICENSE_ALGORITHM],
            issuer=_LICENSE_ISSUER,
        )
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("License token has expired") from exc
    except jwt.InvalidIssuerError as exc:
        raise ValueError("License token has invalid issuer") from exc
    except jwt.InvalidTokenError as exc:
        raise ValueError(f"Invalid license token: {exc}") from exc

    return decoded


async def verify_and_check_scenario(token: str) -> dict:
    """Verify JWT and call Firebase ``incrementScenario`` endpoint.

    Parameters
    ----------
    token:
        The raw JWT string.

    Returns
    -------
    dict
        ``{"allowed": True, "scenariosUsed": int, "maxScenarios": int}``

    Raises
    ------
    ValueError
        If the token is invalid or the scenario limit has been reached.
    """
    if _dev_mode:
        logger.debug("Dev mode: skipping scenario check")
        return {
            "allowed": True,
            "scenariosUsed": 0,
            "maxScenarios": 999,
        }

    claims = verify_license_jwt(token)

    license_key = claims.get("key", "")
    device_id = claims.get("deviceId", "")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{_LICENSE_API_URL}/incrementScenario",
                json={"key": license_key, "deviceId": device_id},
            )

        if response.status_code == 200:
            data = response.json()
            return {
                "allowed": True,
                "scenariosUsed": data.get("scenariosUsed", 0),
                "maxScenarios": data.get("maxScenarios", 0),
            }

        if response.status_code == 403:
            detail = response.text
            raise ValueError(
                f"Scenario limit reached: {detail}"
            )

        # Other HTTP errors — log but don't block
        logger.warning(
            "Firebase incrementScenario returned %s: %s",
            response.status_code,
            response.text,
        )

    except (httpx.RequestError, httpx.TimeoutException) as exc:
        # Network error with valid JWT — offline grace: trust the JWT
        logger.warning(
            "Firebase unreachable (%s), allowing offline grace", exc
        )

    # Offline grace fallback — JWT was valid, allow execution
    return {
        "allowed": True,
        "scenariosUsed": -1,
        "maxScenarios": claims.get("maxScenarios", -1),
    }
