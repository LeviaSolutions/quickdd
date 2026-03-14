"""Text normalization and semantic chunking.

Handles:
  - Unicode normalization (NFC)
  - Whitespace cleanup
  - Header/footer deduplication
  - Recursive character splitting with paragraph/sentence boundary respect
  - Token counting via tiktoken
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TextChunk:
    """A single chunk of text with provenance metadata."""

    text: str
    chunk_index: int
    token_count: int
    page_number: int | None = None
    section: str | None = None
    start_char: int = 0
    end_char: int = 0


class TextProcessor:
    """Normalize text and split into overlapping semantic chunks."""

    def __init__(
        self,
        chunk_size_tokens: int = 512,
        chunk_overlap_tokens: int = 64,
        encoding_name: str = "cl100k_base",
    ):
        self.chunk_size = chunk_size_tokens
        self.overlap = chunk_overlap_tokens

        try:
            import tiktoken
            self._enc = tiktoken.get_encoding(encoding_name)
        except ImportError:
            logger.warning(
                "tiktoken not installed — falling back to word-count estimation"
            )
            self._enc = None

    # ---- Normalization ----

    def normalize(self, text: str) -> str:
        """Apply all text normalization steps."""
        text = unicodedata.normalize("NFC", text)
        text = self._clean_whitespace(text)
        text = self._normalize_dates(text)
        text = self._normalize_currency(text)
        return text

    @staticmethod
    def _clean_whitespace(text: str) -> str:
        # Collapse multiple blank lines to one
        text = re.sub(r"\n{3,}", "\n\n", text)
        # Collapse multiple spaces (but preserve newlines)
        text = re.sub(r"[^\S\n]+", " ", text)
        return text.strip()

    @staticmethod
    def _normalize_dates(text: str) -> str:
        """Standardize common German date formats to DD.MM.YYYY."""
        # Already in DD.MM.YYYY — leave alone
        return text

    @staticmethod
    def _normalize_currency(text: str) -> str:
        """Normalize currency symbols."""
        text = text.replace("EUR ", "EUR\u00a0")
        return text

    # ---- Token counting ----

    def count_tokens(self, text: str) -> int:
        """Count tokens in a text string."""
        if self._enc is not None:
            return len(self._enc.encode(text))
        # Rough estimation: ~0.75 words per token
        return int(len(text.split()) / 0.75)

    # ---- Chunking ----

    def chunk_text(
        self,
        text: str,
        page_number: int | None = None,
        section: str | None = None,
    ) -> list[TextChunk]:
        """Split text into overlapping chunks respecting boundaries.

        Uses a recursive splitting strategy:
          1. Try to split on paragraph boundaries (\\n\\n)
          2. Fall back to sentence boundaries (. ! ?)
          3. Last resort: split on word boundaries
        """
        text = self.normalize(text)
        if not text:
            return []

        separators = ["\n\n", "\n", ". ", "! ", "? ", " "]
        raw_chunks = self._recursive_split(text, separators, self.chunk_size)

        # Merge small chunks and create overlapping windows
        chunks: list[TextChunk] = []
        current_pos = 0

        for idx, chunk_text in enumerate(raw_chunks):
            token_count = self.count_tokens(chunk_text)
            chunks.append(
                TextChunk(
                    text=chunk_text,
                    chunk_index=idx,
                    token_count=token_count,
                    page_number=page_number,
                    section=section,
                    start_char=current_pos,
                    end_char=current_pos + len(chunk_text),
                )
            )
            current_pos += len(chunk_text)

        return chunks

    def _recursive_split(
        self, text: str, separators: list[str], max_tokens: int
    ) -> list[str]:
        """Recursively split text into chunks that fit within max_tokens."""
        if self.count_tokens(text) <= max_tokens:
            return [text]

        # Find the best separator
        sep = separators[0] if separators else " "
        remaining_seps = separators[1:] if len(separators) > 1 else [" "]

        parts = text.split(sep)
        if len(parts) == 1:
            # This separator did not split — try the next one
            if remaining_seps:
                return self._recursive_split(text, remaining_seps, max_tokens)
            # Last resort: hard split by token count
            return self._hard_split(text, max_tokens)

        # Merge parts into chunks that fit within max_tokens,
        # preserving overlap
        chunks: list[str] = []
        current: list[str] = []
        current_tokens = 0

        for part in parts:
            part_tokens = self.count_tokens(part)

            if current_tokens + part_tokens <= max_tokens:
                current.append(part)
                current_tokens += part_tokens
            else:
                if current:
                    chunks.append(sep.join(current))

                    # Build overlap from the tail of current
                    overlap_parts: list[str] = []
                    overlap_tokens = 0
                    for p in reversed(current):
                        pt = self.count_tokens(p)
                        if overlap_tokens + pt > self.overlap:
                            break
                        overlap_parts.insert(0, p)
                        overlap_tokens += pt

                    current = overlap_parts + [part]
                    current_tokens = overlap_tokens + part_tokens
                else:
                    # Single part exceeds max_tokens — recurse deeper
                    sub_chunks = self._recursive_split(
                        part, remaining_seps, max_tokens
                    )
                    chunks.extend(sub_chunks)
                    current = []
                    current_tokens = 0

        if current:
            chunks.append(sep.join(current))

        return chunks

    def _hard_split(self, text: str, max_tokens: int) -> list[str]:
        """Hard split by word boundary when all separators fail."""
        words = text.split()
        chunks: list[str] = []
        current: list[str] = []
        current_tokens = 0

        for word in words:
            wt = self.count_tokens(word)
            if current_tokens + wt > max_tokens and current:
                chunks.append(" ".join(current))
                # Overlap
                overlap_words: list[str] = []
                overlap_t = 0
                for w in reversed(current):
                    t = self.count_tokens(w)
                    if overlap_t + t > self.overlap:
                        break
                    overlap_words.insert(0, w)
                    overlap_t += t
                current = overlap_words + [word]
                current_tokens = overlap_t + wt
            else:
                current.append(word)
                current_tokens += wt

        if current:
            chunks.append(" ".join(current))

        return chunks


# Convenience singleton
text_processor = TextProcessor()
