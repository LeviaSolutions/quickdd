"""Plain text, Markdown, and RTF parser.

Handles .txt, .md, .rtf with automatic encoding detection.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.parsers.base import (
    BaseParser,
    ExtractedPage,
    ParseResult,
)

logger = logging.getLogger(__name__)


class TextParser(BaseParser):
    """Parse plain text, Markdown, and RTF files."""

    @property
    def supported_mimes(self) -> set[str]:
        return {
            "text/plain",
            "text/markdown",
            "text/rtf",
            "application/rtf",
        }

    @property
    def supported_extensions(self) -> set[str]:
        return {".txt", ".md", ".rtf", ".text", ".log"}

    async def parse(self, file_path: Path) -> ParseResult:
        result = ParseResult()

        raw = file_path.read_bytes()

        # RTF handling
        if file_path.suffix.lower() == ".rtf":
            try:
                from striprtf.striprtf import rtf_to_text

                text = rtf_to_text(raw.decode("utf-8", errors="replace"))
            except ImportError:
                result.warnings.append(
                    "striprtf not installed — raw RTF content returned"
                )
                text = raw.decode("utf-8", errors="replace")
            except Exception as exc:
                logger.warning("RTF parsing failed: %s", exc)
                text = raw.decode("utf-8", errors="replace")
                result.warnings.append(f"RTF parsing failed: {exc}")
        else:
            # Detect encoding
            try:
                import chardet

                detected = chardet.detect(raw)
                encoding = detected.get("encoding", "utf-8") or "utf-8"
                text = raw.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                text = raw.decode("utf-8", errors="replace")
                result.warnings.append("Encoding detection failed")

        result.pages.append(
            ExtractedPage(page_number=1, text=text)
        )
        result.page_count = 1
        result.metadata = {
            "file_size": len(raw),
            "encoding": "utf-8",
        }

        return result
