"""Extract PDF pages as images for vision-based LLM analysis."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_page_images(pdf_path: str | Path, dpi: int = 150) -> dict[int, str]:
    """Render each PDF page as a PNG and return base64-encoded images.

    Returns dict mapping page_number (1-based) to base64 PNG string.
    """
    import fitz  # PyMuPDF

    images: dict[int, str] = {}
    doc = fitz.open(str(pdf_path))
    try:
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(matrix=matrix)
            img_bytes = pix.tobytes("png")
            b64 = base64.b64encode(img_bytes).decode("ascii")
            images[page_num + 1] = b64
    finally:
        doc.close()
    logger.info("Extracted %d page images from %s", len(images), pdf_path)
    return images


def build_vision_content(
    text_context: str,
    page_images: dict[int, str],
    relevant_pages: list[int],
    max_images: int = 5,
) -> list[dict]:
    """Build multimodal content blocks for the LLM (OpenAI-compatible format).

    Combines text context with relevant page images.
    Returns a list of content blocks (image_url and text dicts).
    """
    content_blocks: list[dict] = []
    pages_to_include = relevant_pages[:max_images]
    for page_num in pages_to_include:
        if page_num in page_images:
            content_blocks.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{page_images[page_num]}",
                    "detail": "high",
                },
            })
    content_blocks.append({"type": "text", "text": text_context})
    return content_blocks
