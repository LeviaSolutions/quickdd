"""Security services — encryption, secure delete, audit logging."""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class EncryptionService:
    """AES-256 encryption for project directories."""

    @staticmethod
    def derive_key(passphrase: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
        """Derive an AES-256 key from a passphrase using PBKDF2.

        Returns (key, salt).
        """
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives import hashes

        if salt is None:
            salt = os.urandom(16)

        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=settings.encryption_iterations,
        )

        key = kdf.derive(passphrase.encode("utf-8"))
        return key, salt

    @staticmethod
    def encrypt_file(file_path: Path, key: bytes) -> None:
        """Encrypt a file in place using AES-256-GCM."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        data = file_path.read_bytes()
        nonce = os.urandom(12)
        aesgcm = AESGCM(key)
        encrypted = aesgcm.encrypt(nonce, data, None)

        # Write nonce + ciphertext
        file_path.write_bytes(nonce + encrypted)

    @staticmethod
    def decrypt_file(file_path: Path, key: bytes) -> bytes:
        """Decrypt a file encrypted with encrypt_file."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        raw = file_path.read_bytes()
        nonce = raw[:12]
        ciphertext = raw[12:]

        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ciphertext, None)


class SecureDeleteService:
    """DoD 5220.22-M compliant secure file deletion."""

    @staticmethod
    def secure_delete(file_path: Path, passes: int | None = None) -> None:
        """Overwrite a file with random data before deleting.

        Uses the configured number of overwrite passes (default 3).
        """
        passes = passes or settings.secure_delete_passes

        if not file_path.is_file():
            return

        file_size = file_path.stat().st_size

        with open(file_path, "r+b") as f:
            for pass_num in range(passes):
                f.seek(0)
                if pass_num % 3 == 0:
                    f.write(b"\x00" * file_size)  # Zeros
                elif pass_num % 3 == 1:
                    f.write(b"\xff" * file_size)  # Ones
                else:
                    f.write(os.urandom(file_size))  # Random
                f.flush()
                os.fsync(f.fileno())

        file_path.unlink()
        logger.info("Securely deleted: %s (%d passes)", file_path, passes)

    @classmethod
    def secure_delete_directory(cls, dir_path: Path) -> None:
        """Recursively secure-delete all files in a directory."""
        if not dir_path.is_dir():
            return

        for file_path in dir_path.rglob("*"):
            if file_path.is_file():
                cls.secure_delete(file_path)

        # Remove empty directory tree
        import shutil
        shutil.rmtree(str(dir_path), ignore_errors=True)


class AuditLogger:
    """Record all significant actions in the audit log."""

    def __init__(self, db):
        self.db = db

    async def log(
        self,
        action: str,
        *,
        project_id: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
        user_name: str = "system",
    ) -> None:
        """Write an audit log entry."""
        import orjson

        await self.db.execute(
            """INSERT INTO audit_log
               (project_id, action, entity_type, entity_id, details, user_name)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6)""",
            project_id,
            action,
            entity_type,
            entity_id,
            orjson.dumps(details or {}).decode(),
            user_name,
        )
