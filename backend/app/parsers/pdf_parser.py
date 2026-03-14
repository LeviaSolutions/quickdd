"""PDF parser using PyMuPDF (fitz) for text and pdfplumber for tables.

Handles both native-text PDFs and scanned/image PDFs (the latter are
detected by low text-per-page ratios and routed to the OCR pipeline).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.parsers.base import (
    BaseParser,
    ExtractedPage,
    ExtractedTable,
    ParseResult,
)

logger = logging.getLogger(__name__)


class PDFParser(BaseParser):
    """Extract text and tables from PDF files."""

    @property
    def supported_mimes(self) -> set[str]:
        return {"application/pdf"}

    @property
    def supported_extensions(self) -> set[str]:
        return {".pdf"}

    async def parse(self, file_path: Path) -> ParseResult:
        import fitz  # PyMuPDF

        result = ParseResult()

        try:
            doc = fitz.open(str(file_path))
        except Exception as exc:
            logger.error("Failed to open PDF %s: %s", file_path, exc)
            result.warnings.append(f"Failed to open: {exc}")
            return result

        result.page_count = len(doc)
        result.metadata = self._extract_metadata(doc)

        scanned_pages: list[int] = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text")

            # Detect scanned pages: very little text relative to page area
            if len(text.strip()) < 50 and page.rect.width > 0:
                scanned_pages.append(page_num)
                text = f"[Scanned page {page_num + 1} — OCR required]"

            result.pages.append(
                ExtractedPage(
                    page_number=page_num + 1,
                    text=text,
                )
            )

        doc.close()

        # Extract tables via pdfplumber
        try:
            result.tables = await self._extract_tables(file_path)
        except Exception as exc:
            logger.warning("Table extraction failed for %s: %s", file_path, exc)
            result.warnings.append(f"Table extraction failed: {exc}")

        if scanned_pages:
            result.warnings.append(
                f"Scanned pages detected: {scanned_pages}. OCR processing needed."
            )

        return result

    async def _extract_tables(self, file_path: Path) -> list[ExtractedTable]:
        """Use pdfplumber for structured table extraction."""
        import pdfplumber

        tables: list[ExtractedTable] = []
        table_idx = 0

        with pdfplumber.open(str(file_path)) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                page_tables = page.extract_tables()
                if not page_tables:
                    continue

                for raw_table in page_tables:
                    if not raw_table or len(raw_table) < 2:
                        continue

                    headers = [
                        str(cell).strip() if cell else ""
                        for cell in raw_table[0]
                    ]
                    rows = [
                        [str(cell).strip() if cell else "" for cell in row]
                        for row in raw_table[1:]
                    ]

                    tables.append(
                        ExtractedTable(
                            table_index=table_idx,
                            headers=headers,
                            rows=rows,
                            page_number=page_num,
                        )
                    )
                    table_idx += 1

        return tables

    @staticmethod
    def _extract_metadata(doc: Any) -> dict[str, Any]:
        """Pull PDF metadata into a dict."""
        meta = doc.metadata or {}
        return {
            "title": meta.get("title", ""),
            "author": meta.get("author", ""),
            "subject": meta.get("subject", ""),
            "creator": meta.get("creator", ""),
            "producer": meta.get("producer", ""),
            "creation_date": meta.get("creationDate", ""),
            "mod_date": meta.get("modDate", ""),
        }
