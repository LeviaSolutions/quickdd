"""Archive parser for .zip, .7z, and .rar files.

Extracts archive contents to a temporary directory and returns
child file paths for recursive processing by the pipeline.
"""

from __future__ import annotations

import logging
import tempfile
import zipfile
from pathlib import Path

from app.parsers.base import (
    BaseParser,
    ParseResult,
)

logger = logging.getLogger(__name__)


class ArchiveParser(BaseParser):
    """Extract archive contents for recursive processing."""

    @property
    def supported_mimes(self) -> set[str]:
        return {
            "application/zip",
            "application/x-zip-compressed",
            "application/x-7z-compressed",
            "application/x-rar-compressed",
            "application/vnd.rar",
        }

    @property
    def supported_extensions(self) -> set[str]:
        return {".zip", ".7z", ".rar"}

    async def parse(self, file_path: Path) -> ParseResult:
        result = ParseResult()
        ext = file_path.suffix.lower()

        tmp_dir = Path(tempfile.mkdtemp(prefix="dda_archive_"))

        try:
            if ext == ".zip":
                await self._extract_zip(file_path, tmp_dir, result)
            elif ext == ".7z":
                await self._extract_7z(file_path, tmp_dir, result)
            elif ext == ".rar":
                await self._extract_rar(file_path, tmp_dir, result)
            else:
                result.warnings.append(f"Unknown archive format: {ext}")
        except Exception as exc:
            logger.error("Archive extraction failed for %s: %s", file_path, exc)
            result.warnings.append(f"Extraction failed: {exc}")

        result.metadata = {
            "archive_type": ext,
            "file_count": len(result.child_files),
        }

        return result

    @staticmethod
    def _is_safe_path(tmp_dir: Path, target: Path) -> bool:
        """Validate extracted path stays within tmp_dir (Zip Slip protection)."""
        try:
            target.resolve().relative_to(tmp_dir.resolve())
            return True
        except ValueError:
            return False

    async def _extract_zip(
        self, file_path: Path, tmp_dir: Path, result: ParseResult
    ) -> None:
        with zipfile.ZipFile(str(file_path), "r") as zf:
            # Check for encrypted entries
            for info in zf.infolist():
                if info.flag_bits & 0x1:
                    result.warnings.append(
                        f"Encrypted file in archive: {info.filename}"
                    )
                    continue

                if info.is_dir():
                    continue

                # Zip Slip protection: validate target path before extraction
                target = tmp_dir / info.filename
                if not self._is_safe_path(tmp_dir, target):
                    logger.warning(
                        "Zip Slip attempt blocked: %s", info.filename
                    )
                    result.warnings.append(
                        f"Blocked path traversal: {info.filename}"
                    )
                    continue

                extracted = Path(zf.extract(info, path=str(tmp_dir)))
                result.child_files.append(extracted)

    async def _extract_7z(
        self, file_path: Path, tmp_dir: Path, result: ParseResult
    ) -> None:
        try:
            import py7zr

            with py7zr.SevenZipFile(str(file_path), mode="r") as archive:
                archive.extractall(path=str(tmp_dir))

            for extracted in tmp_dir.rglob("*"):
                if extracted.is_file() and self._is_safe_path(tmp_dir, extracted):
                    result.child_files.append(extracted)
        except ImportError:
            result.warnings.append("py7zr not installed — cannot extract .7z")

    async def _extract_rar(
        self, file_path: Path, tmp_dir: Path, result: ParseResult
    ) -> None:
        try:
            import rarfile

            with rarfile.RarFile(str(file_path), "r") as rf:
                rf.extractall(path=str(tmp_dir))

            for extracted in tmp_dir.rglob("*"):
                if extracted.is_file() and self._is_safe_path(tmp_dir, extracted):
                    result.child_files.append(extracted)
        except ImportError:
            result.warnings.append("rarfile not installed — cannot extract .rar")
