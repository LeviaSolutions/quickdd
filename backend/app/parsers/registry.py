"""Parser registry — maps MIME types and extensions to parser instances.

The pipeline uses ``get_parser(mime_type, extension)`` to find the
right parser for each uploaded file.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from app.parsers.archive_parser import ArchiveParser
from app.parsers.base import BaseParser
from app.parsers.docx_parser import DocxParser
from app.parsers.email_parser import EmailParser
from app.parsers.image_parser import ImageParser
from app.parsers.pdf_parser import PDFParser
from app.parsers.pptx_parser import PptxParser
from app.parsers.text_parser import TextParser
from app.parsers.xlsx_parser import XlsxParser

logger = logging.getLogger(__name__)

# All available parsers, ordered by specificity
_PARSERS: list[BaseParser] = [
    PDFParser(),
    DocxParser(),
    XlsxParser(),
    PptxParser(),
    EmailParser(),
    ImageParser(),
    TextParser(),
    ArchiveParser(),
]


def get_parser(mime_type: str, extension: str) -> BaseParser | None:
    """Find the best parser for a given MIME type and extension.

    Returns ``None`` if no parser can handle the file.
    """
    # Prefer MIME-type match
    for parser in _PARSERS:
        if mime_type in parser.supported_mimes:
            return parser

    # Fallback to extension match
    ext = extension.lower() if extension.startswith(".") else f".{extension.lower()}"
    for parser in _PARSERS:
        if ext in parser.supported_extensions:
            return parser

    logger.warning(
        "No parser found for MIME=%s, ext=%s", mime_type, extension
    )
    return None


def detect_mime_type(file_path: Path) -> str:
    """Detect MIME type using python-magic, with extension fallback."""
    try:
        import magic

        mime = magic.from_file(str(file_path), mime=True)
        if mime:
            return mime
    except ImportError:
        logger.debug("python-magic not available, using extension-based detection")
    except Exception as exc:
        logger.warning("MIME detection failed for %s: %s", file_path, exc)

    # Extension-based fallback
    ext_map = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".csv": "text/csv",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".eml": "message/rfc822",
        ".msg": "application/vnd.ms-outlook",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".rtf": "text/rtf",
        ".zip": "application/zip",
        ".7z": "application/x-7z-compressed",
        ".rar": "application/x-rar-compressed",
        ".xml": "application/xml",
        ".json": "application/json",
    }

    return ext_map.get(file_path.suffix.lower(), "application/octet-stream")
