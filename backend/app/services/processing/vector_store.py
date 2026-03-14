"""ChromaDB vector store management.

Each project gets its own ChromaDB collection for isolated retrieval.
Supports:
  - Per-project collections for text chunks
  - Separate table collections for structured table QA
  - Batch insert/query operations
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class VectorStoreManager:
    """Manage ChromaDB collections for all projects."""

    def __init__(self) -> None:
        self._client = None

    def _get_client(self):
        """Lazy-initialize ChromaDB client."""
        if self._client is None:
            import chromadb
            from chromadb.config import Settings as ChromaSettings

            persist_dir = str(settings.projects_dir / "_chroma")
            Path(persist_dir).mkdir(parents=True, exist_ok=True)

            self._client = chromadb.Client(
                ChromaSettings(
                    chroma_db_impl="duckdb+parquet",
                    persist_directory=persist_dir,
                    anonymized_telemetry=False,
                )
            )
        return self._client

    def get_collection(self, project_id: str, collection_type: str = "chunks"):
        """Get or create a ChromaDB collection for a project.

        Args:
            project_id: UUID of the project.
            collection_type: "chunks" for text chunks, "tables" for
                             structured table embeddings.
        """
        client = self._get_client()
        name = f"{project_id}_{collection_type}"
        # ChromaDB collection names must be 3-63 chars, alphanumeric + underscores
        name = name[:63]
        return client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )

    async def add_chunks(
        self,
        project_id: str,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]],
    ) -> None:
        """Insert chunk embeddings into the project collection."""
        collection = self.get_collection(project_id, "chunks")
        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        logger.info(
            "Added %d chunks to collection for project %s",
            len(ids),
            project_id,
        )

    async def add_tables(
        self,
        project_id: str,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]],
    ) -> None:
        """Insert table embeddings into the project tables collection."""
        collection = self.get_collection(project_id, "tables")
        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )

    async def query_chunks(
        self,
        project_id: str,
        query_embedding: list[float],
        n_results: int = 20,
        where: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Semantic search over chunk embeddings."""
        collection = self.get_collection(project_id, "chunks")
        kwargs: dict[str, Any] = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
        }
        if where:
            kwargs["where"] = where
        return collection.query(**kwargs)

    async def query_tables(
        self,
        project_id: str,
        query_embedding: list[float],
        n_results: int = 5,
    ) -> dict[str, Any]:
        """Semantic search over table embeddings."""
        collection = self.get_collection(project_id, "tables")
        return collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
        )

    async def delete_project(self, project_id: str) -> None:
        """Remove all collections for a project."""
        client = self._get_client()
        for suffix in ("chunks", "tables"):
            name = f"{project_id}_{suffix}"[:63]
            try:
                client.delete_collection(name)
                logger.info("Deleted collection %s", name)
            except Exception:
                pass  # Collection may not exist

    async def get_collection_count(
        self, project_id: str, collection_type: str = "chunks"
    ) -> int:
        """Return the number of items in a collection."""
        collection = self.get_collection(project_id, collection_type)
        return collection.count()
