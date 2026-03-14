"""Document processing pipeline orchestrator.

Coordinates the full ingestion flow for each uploaded file:
  1. File intake (hash, copy, metadata)
  2. Format detection (MIME)
  3. Content extraction (parser dispatch)
  4. Structured table extraction
  5. Text normalization
  6. Semantic chunking
  7. Embedding generation
  8. Vector indexing

Handles recursive processing for archives and email attachments.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

import asyncpg
import orjson

from app.core.config import settings
from app.parsers.base import BaseParser, ParseResult
from app.parsers.registry import detect_mime_type, get_parser
from app.services.processing.page_images import extract_page_images
from app.services.processing.text_processing import TextChunk, text_processor
from app.services.processing.vector_store import VectorStoreManager

logger = logging.getLogger(__name__)


class DocumentPipeline:
    """Orchestrate the full document processing flow."""

    def __init__(
        self,
        db: asyncpg.Connection,
        vector_store: VectorStoreManager,
        embedding_fn=None,
    ):
        self.db = db
        self.vector_store = vector_store
        self._embed = embedding_fn  # Callable[[list[str]], list[list[float]]]

    async def process_file(
        self,
        project_id: str,
        file_path: Path,
        *,
        depth: int = 0,
        max_depth: int = 3,
    ) -> str | None:
        """Process a single file through the pipeline.

        Returns the document ID on success, None on failure.
        Recursively processes child files (archives, email attachments)
        up to ``max_depth``.
        """
        if depth > max_depth:
            logger.warning(
                "Max recursion depth reached for %s", file_path
            )
            return None

        doc_id = str(uuid.uuid4())

        # Step 1: File intake
        file_hash = BaseParser.compute_hash(file_path)

        # Check for duplicates
        existing = await self.db.fetchrow(
            "SELECT id FROM documents WHERE project_id = $1 AND file_hash = $2",
            project_id, file_hash,
        )
        if existing:
            logger.info("Duplicate file skipped: %s", file_path.name)
            return None

        # Copy to project storage with sanitized filename
        project_dir = settings.projects_dir / project_id / "original"
        project_dir.mkdir(parents=True, exist_ok=True)
        safe_name = Path(file_path.name).name.replace("..", "_").replace("/", "_").replace("\\", "_")
        if not safe_name or safe_name.startswith("."):
            safe_name = f"{uuid.uuid4().hex[:8]}{file_path.suffix}"
        stored_path = project_dir / safe_name
        if stored_path.exists():
            stored_path = project_dir / f"{uuid.uuid4().hex[:8]}_{safe_name}"
        # Verify stored_path is still within project directory
        if not str(stored_path.resolve()).startswith(str(project_dir.resolve())):
            raise ValueError(f"Path traversal detected: {safe_name}")
        shutil.copy2(str(file_path), str(stored_path))

        # Step 2: Format detection
        mime_type = detect_mime_type(file_path)

        await self.db.execute(
            """INSERT INTO documents
               (id, project_id, filename, original_path, stored_path,
                file_size, mime_type, file_hash, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'detecting')""",
            doc_id,
            project_id,
            file_path.name,
            str(file_path),
            str(stored_path),
            file_path.stat().st_size,
            mime_type,
            file_hash,
        )

        # Step 3: Content extraction
        extension = file_path.suffix
        parser = get_parser(mime_type, extension)
        if parser is None:
            await self._update_status(doc_id, "skipped", f"No parser for {mime_type}")
            return doc_id

        await self._update_status(doc_id, "extracting")

        try:
            parse_result = await parser.parse(file_path)
        except Exception as exc:
            logger.error("Parsing failed for %s: %s", file_path, exc)
            await self._update_status(doc_id, "error", str(exc))
            return doc_id

        # Update document metadata
        await self.db.execute(
            """UPDATE documents
               SET page_count = $1, ocr_confidence = $2,
                   metadata_json = $3::jsonb, status = 'chunking'
               WHERE id = $4""",
            parse_result.page_count,
            parse_result.ocr_confidence,
            orjson.dumps(parse_result.metadata).decode(),
            doc_id,
        )

        # Step 4: Store structured tables
        for table in parse_result.tables:
            table_id = str(uuid.uuid4())
            await self.db.execute(
                """INSERT INTO tables_extracted
                   (id, document_id, table_index, page_number, caption,
                    headers_json, rows_json, row_count, col_count, table_type)
                   VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)""",
                table_id,
                doc_id,
                table.table_index,
                table.page_number,
                table.caption,
                orjson.dumps(table.headers).decode(),
                orjson.dumps(table.rows).decode(),
                len(table.rows),
                len(table.headers),
                table.table_type,
            )

        # Step 4b: Extract and store page images for PDFs
        if mime_type and "pdf" in mime_type:
            try:
                page_images = extract_page_images(stored_path)
                images_dir = Path(settings.data_dir) / "page_images" / str(doc_id)
                images_dir.mkdir(parents=True, exist_ok=True)
                for page_num, b64_data in page_images.items():
                    (images_dir / f"page_{page_num}.b64").write_text(b64_data)
                logger.info(
                    "Stored %d page images for document %s",
                    len(page_images),
                    doc_id,
                )
            except Exception as exc:
                logger.warning("Failed to extract page images: %s", exc)

        # Step 5 + 6: Normalize and chunk
        all_chunks: list[TextChunk] = []
        for page in parse_result.pages:
            chunks = text_processor.chunk_text(
                page.text,
                page_number=page.page_number,
                section=page.section,
            )
            all_chunks.extend(chunks)

        # Re-index chunk indices sequentially
        for i, chunk in enumerate(all_chunks):
            chunk.chunk_index = i

        # Store chunks in PostgreSQL
        chunk_ids: list[str] = []
        chunk_texts: list[str] = []
        chunk_metadatas: list[dict[str, Any]] = []

        for chunk in all_chunks:
            chunk_id = str(uuid.uuid4())
            chunk_ids.append(chunk_id)
            chunk_texts.append(chunk.text)
            chunk_metadatas.append({
                "document_id": doc_id,
                "filename": file_path.name,
                "page_number": chunk.page_number or 0,
                "section": chunk.section or "",
                "chunk_index": chunk.chunk_index,
            })

            await self.db.execute(
                """INSERT INTO chunks
                   (id, document_id, chunk_index, text, page_number,
                    section, token_count, start_char, end_char)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                chunk_id,
                doc_id,
                chunk.chunk_index,
                chunk.text,
                chunk.page_number,
                chunk.section,
                chunk.token_count,
                chunk.start_char,
                chunk.end_char,
            )

        # Step 7: Embedding generation
        if self._embed and chunk_texts:
            await self._update_status(doc_id, "embedding")
            try:
                embeddings = await self._embed(chunk_texts)

                # Step 8: Vector indexing
                await self.vector_store.add_chunks(
                    project_id=project_id,
                    ids=chunk_ids,
                    embeddings=embeddings,
                    documents=chunk_texts,
                    metadatas=chunk_metadatas,
                )

                # Update chunk records with embedding IDs
                for chunk_id_val in chunk_ids:
                    await self.db.execute(
                        "UPDATE chunks SET embedding_id = $1 WHERE id = $2",
                        chunk_id_val, chunk_id_val,
                    )

                await self._update_status(doc_id, "indexed")
            except Exception as exc:
                logger.error("Embedding/indexing failed: %s", exc)
                await self._update_status(doc_id, "error", f"Embedding failed: {exc}")
        else:
            # Mark as indexed even without embeddings (they can be added later)
            await self._update_status(doc_id, "indexed")

        # Update project file count
        await self.db.execute(
            """UPDATE projects
               SET file_count = (
                   SELECT COUNT(*) FROM documents WHERE project_id = $1
               ), updated_at = now()
               WHERE id = $1""",
            project_id,
        )

        # Recursively process child files (archives, email attachments)
        for child_path in parse_result.child_files:
            if child_path.is_file():
                await self.process_file(
                    project_id, child_path, depth=depth + 1
                )

        return doc_id

    async def _update_status(
        self, doc_id: str, status: str, error: str | None = None
    ) -> None:
        """Update document processing status."""
        await self.db.execute(
            """UPDATE documents
               SET status = $1, error_message = $2,
                   updated_at = now()
               WHERE id = $3""",
            status, error, doc_id,
        )
