"""Abstract base class for all document parsers.

Every file format gets a parser that implements this interface.
The processing pipeline calls ``parse()`` on the appropriate parser
based on MIME-type detection.
"""

from __future__ import annotations

import abc
import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ExtractedTable:
    """A structured table extracted from a document."""

    table_index: int
    headers: list[str]
    rows: list[list[Any]]
    page_number: int | None = None
    caption: str | None = None
    table_type: str | None = None  # rent_roll, opex, capex, etc.


@dataclass
class ExtractedPage:
    """Text content from a single page / sheet / slide."""

    page_number: int
    text: str
    section: str | None = None


@dataclass
class ParseResult:
    """Unified output from any document parser.

    Every parser must return exactly one ``ParseResult``.
    """

    pages: list[ExtractedPage] = field(default_factory=list)
    tables: list[ExtractedTable] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    page_count: int = 0
    ocr_confidence: float | None = None
    warnings: list[str] = field(default_factory=list)
    child_files: list[Path] = field(default_factory=list)  # for archives / emails

    @property
    def full_text(self) -> str:
        """Concatenated text from all pages."""
        return "\n\n".join(p.text for p in self.pages if p.text.strip())


class BaseParser(abc.ABC):
    """Abstract base for document parsers.

    Subclasses must implement:
      - ``supported_mimes`` — set of MIME types this parser handles
      - ``supported_extensions`` — set of file extensions (with dot)
      - ``parse(file_path)`` — extract content

    The pipeline selects a parser by matching the detected MIME type
    against ``supported_mimes``, with ``supported_extensions`` as a
    fallback when MIME detection is ambiguous.
    """

    @property
    @abc.abstractmethod
    def supported_mimes(self) -> set[str]:
        """MIME types this parser can process."""
        ...

    @property
    @abc.abstractmethod
    def supported_extensions(self) -> set[str]:
        """File extensions (with leading dot) this parser handles."""
        ...

    @abc.abstractmethod
    async def parse(self, file_path: Path) -> ParseResult:
        """Parse the file and return structured content.

        Implementations should:
          1. Extract all textual content page-by-page.
          2. Extract structured tables where applicable.
          3. Populate metadata (author, title, creation date, etc.).
          4. Set ``ocr_confidence`` if OCR was used.
          5. Append to ``warnings`` for any non-fatal issues.
          6. Populate ``child_files`` if the file contains attachments
             or archive members that need recursive processing.

        Must not raise on recoverable errors — instead, log the error,
        add to warnings, and return whatever could be extracted.
        """
        ...

    def can_handle(self, mime_type: str, extension: str) -> bool:
        """Check if this parser can handle the given file."""
        return (
            mime_type in self.supported_mimes
            or extension.lower() in self.supported_extensions
        )

    @staticmethod
    def compute_hash(file_path: Path) -> str:
        """Compute SHA-256 hash of a file."""
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()
