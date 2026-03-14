"""Authentication and admin user management routes."""

from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID

import asyncpg
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.core.jwt_auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    require_admin,
)
from app.db.postgres import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    email: str
    password: str


class UserInfo(BaseModel):
    id: UUID
    email: str
    name: str
    role: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserInfo


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessTokenResponse(BaseModel):
    access_token: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=4, max_length=200)
    role: str = Field(default="viewer", pattern="^(admin|analyst|viewer)$")


class UpdateUserRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = Field(default=None, pattern="^(admin|analyst|viewer)$")
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=200)


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    is_active: bool
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def _row_to_user_response(row: asyncpg.Record) -> UserResponse:
    """Convert a database row to a UserResponse."""
    return UserResponse(
        id=row["id"],
        email=row["email"],
        name=row["name"],
        role=row["role"],
        is_active=row["is_active"],
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
    )


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Authenticate with email and password, receive JWT tokens."""
    row = await db.fetchrow(
        "SELECT id, email, name, password_hash, role, is_active FROM users WHERE email = $1",
        body.email,
    )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is deactivated",
        )

    if not _verify_password(body.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    user_id: UUID = row["id"]
    role: str = row["role"]

    access_token = create_access_token(user_id, role)
    refresh_token = create_refresh_token(user_id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserInfo(
            id=user_id,
            email=row["email"],
            name=row["name"],
            role=role,
        ),
    )


@router.post("/auth/refresh", response_model=AccessTokenResponse)
async def refresh(
    body: RefreshRequest,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Exchange a valid refresh token for a new access token."""
    payload = decode_token(body.refresh_token)

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type — refresh token required",
        )

    try:
        user_id = UUID(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Verify the user still exists and is active
    row = await db.fetchrow(
        "SELECT id, role, is_active FROM users WHERE id = $1",
        user_id,
    )

    if row is None or not row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated",
        )

    access_token = create_access_token(user_id, row["role"])
    return AccessTokenResponse(access_token=access_token)


# ---------------------------------------------------------------------------
# Authenticated endpoints
# ---------------------------------------------------------------------------


@router.get("/auth/me", response_model=UserResponse)
async def me(
    current_user: dict = Depends(get_current_user),
    db: Annotated[asyncpg.Connection, Depends(get_db)] = None,
):
    """Return the currently authenticated user's profile."""
    row = await db.fetchrow(
        "SELECT id, email, name, role, is_active, created_at, updated_at FROM users WHERE id = $1",
        current_user["user_id"],
    )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return _row_to_user_response(row)


# ---------------------------------------------------------------------------
# Admin-only endpoints
# ---------------------------------------------------------------------------


@router.get("/admin/users", response_model=list[UserResponse])
async def list_users(
    _admin: dict = Depends(require_admin),
    db: Annotated[asyncpg.Connection, Depends(get_db)] = None,
):
    """List all users (admin only)."""
    rows = await db.fetch(
        "SELECT id, email, name, role, is_active, created_at, updated_at FROM users ORDER BY created_at",
    )
    return [_row_to_user_response(row) for row in rows]


@router.post(
    "/admin/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    body: CreateUserRequest,
    _admin: dict = Depends(require_admin),
    db: Annotated[asyncpg.Connection, Depends(get_db)] = None,
):
    """Create a new user (admin only)."""
    # Check for existing email
    existing = await db.fetchval(
        "SELECT COUNT(*) FROM users WHERE email = $1",
        body.email,
    )
    if existing > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    password_hash = _hash_password(body.password)

    row = await db.fetchrow(
        """INSERT INTO users (email, name, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, name, role, is_active, created_at, updated_at""",
        body.email,
        body.name,
        password_hash,
        body.role,
    )

    logger.info("Created user %s (%s) with role %s", row["email"], row["id"], row["role"])
    return _row_to_user_response(row)


@router.patch("/admin/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    _admin: dict = Depends(require_admin),
    db: Annotated[asyncpg.Connection, Depends(get_db)] = None,
):
    """Update user fields (admin only)."""
    # Build dynamic SET clause from provided fields
    updates: list[str] = []
    values: list = []
    param_idx = 1

    if body.name is not None:
        updates.append(f"name = ${param_idx}")
        values.append(body.name)
        param_idx += 1

    if body.role is not None:
        updates.append(f"role = ${param_idx}")
        values.append(body.role)
        param_idx += 1

    if body.is_active is not None:
        updates.append(f"is_active = ${param_idx}")
        values.append(body.is_active)
        param_idx += 1

    if body.password is not None:
        updates.append(f"password_hash = ${param_idx}")
        values.append(_hash_password(body.password))
        param_idx += 1

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    updates.append(f"updated_at = now()")

    # Add user_id as the final parameter
    values.append(user_id)
    set_clause = ", ".join(updates)

    row = await db.fetchrow(
        f"""UPDATE users SET {set_clause}
            WHERE id = ${param_idx}
            RETURNING id, email, name, role, is_active, created_at, updated_at""",
        *values,
    )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    logger.info("Updated user %s (%s)", row["email"], row["id"])
    return _row_to_user_response(row)


@router.delete("/admin/users/{user_id}", status_code=status.HTTP_200_OK)
async def delete_user(
    user_id: UUID,
    _admin: dict = Depends(require_admin),
    db: Annotated[asyncpg.Connection, Depends(get_db)] = None,
):
    """Soft-deactivate a user by setting is_active=false (admin only)."""
    row = await db.fetchrow(
        """UPDATE users SET is_active = FALSE, updated_at = now()
           WHERE id = $1
           RETURNING id, email""",
        user_id,
    )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    logger.info("Deactivated user %s (%s)", row["email"], row["id"])
    return {"detail": f"User {row['email']} deactivated"}
