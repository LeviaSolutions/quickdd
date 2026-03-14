"""Image parser stub — delegates to OCR pipeline.

For PNG/JPG/TIFF/BMP files, the text is extracted via OCR.
This parser performs basic image validation and preprocessing,
then returns the OCR result.
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


class ImageParser(BaseParser):
    """Parse image files via OCR."""

    @property
    def supported_mimes(self) -> set[str]:
        return {
            "image/png",
            "image/jpeg",
            "image/tiff",
            "image/bmp",
            "image/webp",
        }

    @property
    def supported_extensions(self) -> set[str]:
        return {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp"}

    async def parse(self, file_path: Path) -> ParseResult:
        result = ParseResult()

        try:
            from PIL import Image

            img = Image.open(file_path)
            result.metadata = {
                "width": img.width,
                "height": img.height,
                "format": img.format,
                "mode": img.mode,
            }
            img.close()
        except Exception as exc:
            logger.error("Failed to open image %s: %s", file_path, exc)
            result.warnings.append(f"Failed to open image: {exc}")
            return result

        # OCR extraction — try PaddleOCR first, fallback to Tesseract
        text = await self._ocr_extract(file_path, result)

        result.pages.append(
            ExtractedPage(page_number=1, text=text)
        )
        result.page_count = 1

        return result

    async def _ocr_extract(
        self, file_path: Path, result: ParseResult
    ) -> str:
        """Run OCR on the image. Returns extracted text."""

        # Try PaddleOCR
        try:
            return await self._paddleocr(file_path, result)
        except ImportError:
            logger.debug("PaddleOCR not available, trying Tesseract")
        except Exception as exc:
            logger.warning("PaddleOCR failed: %s — trying Tesseract", exc)

        # Fallback: Tesseract
        try:
            return await self._tesseract(file_path, result)
        except ImportError:
            result.warnings.append(
                "Neither PaddleOCR nor Tesseract available — no OCR performed"
            )
            return "[OCR not available — install PaddleOCR or Tesseract]"
        except Exception as exc:
            logger.error("Tesseract failed: %s", exc)
            result.warnings.append(f"OCR failed: {exc}")
            return "[OCR failed]"

    async def _paddleocr(
        self, file_path: Path, result: ParseResult
    ) -> str:
        from paddleocr import PaddleOCR

        ocr = PaddleOCR(use_angle_cls=True, lang="de", show_log=False)
        ocr_result = ocr.ocr(str(file_path), cls=True)

        lines: list[str] = []
        confidences: list[float] = []

        for line_group in ocr_result:
            if line_group is None:
                continue
            for item in line_group:
                text = item[1][0]
                conf = item[1][1]
                lines.append(text)
                confidences.append(conf)

        if confidences:
            result.ocr_confidence = sum(confidences) / len(confidences)

        return "\n".join(lines)

    async def _tesseract(
        self, file_path: Path, result: ParseResult
    ) -> str:
        import os
        import pytesseract
        from PIL import Image

        # Configure Tesseract binary and language data paths
        tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        tessdata_dir = os.path.expanduser("~/tessdata")
        if Path(tesseract_cmd).exists():
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        if Path(tessdata_dir).is_dir():
            os.environ["TESSDATA_PREFIX"] = tessdata_dir

        img = Image.open(file_path)
        text = pytesseract.image_to_string(img, lang="deu+eng")

        # Get confidence data
        data = pytesseract.image_to_data(
            img, lang="deu+eng", output_type=pytesseract.Output.DICT
        )
        confs = [
            int(c) for c in data.get("conf", []) if str(c).isdigit() and int(c) > 0
        ]
        if confs:
            result.ocr_confidence = sum(confs) / len(confs) / 100.0

        img.close()
        return text
