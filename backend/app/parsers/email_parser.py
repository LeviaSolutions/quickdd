"""Email parser for .eml and .msg files.

Extracts subject, body, and recursively yields attachment paths
for further processing by the pipeline.
"""

from __future__ import annotations

import email
import email.policy
import logging
import tempfile
from pathlib import Path
from typing import Any

from app.parsers.base import (
    BaseParser,
    ExtractedPage,
    ParseResult,
)

logger = logging.getLogger(__name__)


class EmailParser(BaseParser):
    """Parse .eml and .msg email files."""

    @property
    def supported_mimes(self) -> set[str]:
        return {
            "message/rfc822",
            "application/vnd.ms-outlook",
        }

    @property
    def supported_extensions(self) -> set[str]:
        return {".eml", ".msg"}

    async def parse(self, file_path: Path) -> ParseResult:
        ext = file_path.suffix.lower()
        if ext == ".msg":
            return await self._parse_msg(file_path)
        return await self._parse_eml(file_path)

    async def _parse_eml(self, file_path: Path) -> ParseResult:
        result = ParseResult()

        try:
            with open(file_path, "rb") as f:
                msg = email.message_from_binary_file(
                    f, policy=email.policy.default
                )
        except Exception as exc:
            logger.error("Failed to parse .eml %s: %s", file_path, exc)
            result.warnings.append(f"Failed to parse: {exc}")
            return result

        # Extract metadata
        result.metadata = {
            "subject": msg.get("subject", ""),
            "from": msg.get("from", ""),
            "to": msg.get("to", ""),
            "date": msg.get("date", ""),
            "cc": msg.get("cc", ""),
        }

        # Extract body
        body_parts: list[str] = []
        body_parts.append(f"Subject: {msg.get('subject', '')}")
        body_parts.append(f"From: {msg.get('from', '')}")
        body_parts.append(f"To: {msg.get('to', '')}")
        body_parts.append(f"Date: {msg.get('date', '')}")
        body_parts.append("")

        body = msg.get_body(preferencelist=("plain", "html"))
        if body:
            content = body.get_content()
            if isinstance(content, str):
                body_parts.append(content)

        result.pages.append(
            ExtractedPage(page_number=1, text="\n".join(body_parts))
        )
        result.page_count = 1

        # Extract attachments to temp directory
        for part in msg.walk():
            if part.get_content_disposition() == "attachment":
                filename = part.get_filename()
                if not filename:
                    continue

                payload = part.get_payload(decode=True)
                if not payload:
                    continue

                # Write attachment to temp file for recursive processing
                tmp_dir = Path(tempfile.mkdtemp(prefix="dda_email_"))
                att_path = tmp_dir / filename
                att_path.write_bytes(payload)
                result.child_files.append(att_path)

        return result

    async def _parse_msg(self, file_path: Path) -> ParseResult:
        """Parse Outlook .msg files using extract-msg."""
        result = ParseResult()

        try:
            import extract_msg

            msg = extract_msg.Message(str(file_path))
        except ImportError:
            result.warnings.append(
                "extract-msg not installed — cannot parse .msg files"
            )
            return result
        except Exception as exc:
            logger.error("Failed to parse .msg %s: %s", file_path, exc)
            result.warnings.append(f"Failed to parse: {exc}")
            return result

        result.metadata = {
            "subject": msg.subject or "",
            "sender": msg.sender or "",
            "to": msg.to or "",
            "date": str(msg.date) if msg.date else "",
        }

        body_parts = [
            f"Subject: {msg.subject or ''}",
            f"From: {msg.sender or ''}",
            f"To: {msg.to or ''}",
            f"Date: {msg.date or ''}",
            "",
            msg.body or "",
        ]

        result.pages.append(
            ExtractedPage(page_number=1, text="\n".join(body_parts))
        )
        result.page_count = 1

        # Extract .msg attachments
        tmp_dir = Path(tempfile.mkdtemp(prefix="dda_msg_"))
        for att in msg.attachments:
            try:
                att_path = tmp_dir / (att.longFilename or att.shortFilename or "attachment")
                att.save(customPath=str(tmp_dir))
                if att_path.exists():
                    result.child_files.append(att_path)
            except Exception as exc:
                logger.warning("Attachment extraction failed: %s", exc)
                result.warnings.append(f"Attachment extraction failed: {exc}")

        msg.close()
        return result
