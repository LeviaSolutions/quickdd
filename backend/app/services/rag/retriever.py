"""Hybrid retrieval engine — semantic + BM25 + table QA.

Implements the multi-stage retrieval pipeline:
  1. Semantic search via ChromaDB
  2. BM25 keyword search via PostgreSQL tsvector
  3. Structured table retrieval (for financial/tabular questions)
  4. Reciprocal rank fusion to merge results
  5. Cross-encoder re-ranking
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import asyncpg

from app.core.config import settings
from app.services.processing.vector_store import VectorStoreManager

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunk:
    """A retrieved text chunk with combined relevance score."""

    chunk_id: str
    document_id: str
    text: str
    page_number: int | None
    section: str | None
    filename: str
    score: float  # Combined relevance score after fusion
    source: str = "semantic"  # semantic, bm25, table, or fused


@dataclass
class RetrievalResult:
    """Complete retrieval result for a query."""

    chunks: list[RetrievedChunk] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)
    query: str = ""


class HybridRetriever:
    """Multi-strategy retrieval with reciprocal rank fusion."""

    def __init__(
        self,
        db: asyncpg.Connection,
        vector_store: VectorStoreManager,
        embed_fn=None,
        rerank_fn=None,
    ):
        self.db = db
        self.vector_store = vector_store
        self._embed = embed_fn  # Callable[[str], list[float]]
        self._rerank = rerank_fn  # Callable[[str, list[str]], list[float]]

    async def retrieve(
        self,
        project_id: str,
        query: str,
        *,
        top_k: int | None = None,
        top_n: int | None = None,
        include_tables: bool = False,
        metadata_filter: dict[str, Any] | None = None,
    ) -> RetrievalResult:
        """Run hybrid retrieval for a query.

        Args:
            project_id: UUID of the project to search.
            query: The search query (question text).
            top_k: Number of candidates from each retrieval source.
            top_n: Final number of chunks after re-ranking.
            include_tables: Whether to also query structured tables.
            metadata_filter: ChromaDB metadata filter dict.
        """
        top_k = top_k or settings.retrieval_top_k
        top_n = top_n or settings.rerank_top_n

        result = RetrievalResult(query=query)

        # Run retrieval strategies in parallel
        semantic_chunks = await self._semantic_search(
            project_id, query, top_k, metadata_filter
        )
        bm25_chunks = await self._bm25_search(project_id, query, top_k)

        # Reciprocal rank fusion
        fused = self._reciprocal_rank_fusion(
            [semantic_chunks, bm25_chunks],
            k=60,
        )

        # Re-rank if reranker is available
        if self._rerank and fused:
            texts = [c.text for c in fused]
            try:
                rerank_scores = await self._rerank(query, texts)
                for chunk, score in zip(fused, rerank_scores):
                    chunk.score = score
                fused.sort(key=lambda c: c.score, reverse=True)
            except Exception as exc:
                logger.warning("Re-ranking failed: %s — using fusion scores", exc)

        result.chunks = fused[:top_n]

        # Table retrieval
        if include_tables:
            result.tables = await self._table_search(project_id, query)

        return result

    async def _semantic_search(
        self,
        project_id: str,
        query: str,
        top_k: int,
        where: dict[str, Any] | None,
    ) -> list[RetrievedChunk]:
        """ChromaDB semantic vector search."""
        if self._embed is None:
            return []

        try:
            query_embedding = await self._embed(query)
            results = await self.vector_store.query_chunks(
                project_id=project_id,
                query_embedding=query_embedding,
                n_results=top_k,
                where=where,
            )
        except Exception as exc:
            logger.warning("Semantic search failed: %s", exc)
            return []

        chunks: list[RetrievedChunk] = []
        if not results or not results.get("ids"):
            return chunks

        for i, chunk_id in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i] if results.get("metadatas") else {}
            dist = results["distances"][0][i] if results.get("distances") else 1.0
            doc_text = results["documents"][0][i] if results.get("documents") else ""

            chunks.append(
                RetrievedChunk(
                    chunk_id=chunk_id,
                    document_id=meta.get("document_id", ""),
                    text=doc_text,
                    page_number=meta.get("page_number"),
                    section=meta.get("section"),
                    filename=meta.get("filename", ""),
                    score=1.0 - dist,  # Convert distance to similarity
                    source="semantic",
                )
            )

        return chunks

    async def _bm25_search(
        self, project_id: str, query: str, top_k: int
    ) -> list[RetrievedChunk]:
        """PostgreSQL tsvector full-text search."""
        import re
        words = re.findall(r'\w+', query, re.UNICODE)
        # Filter very short words and limit to most meaningful terms
        words = [w for w in words if len(w) >= 3][:20]
        if not words:
            return []
        # Build tsquery: join terms with | (OR) for broad matching
        ts_query = " | ".join(words)

        try:
            rows = await self.db.fetch(
                """
                SELECT
                    c.id, c.document_id, c.text, c.page_number, c.section,
                    d.filename,
                    ts_rank(c.tsv, to_tsquery('simple', $2)) AS rank
                FROM chunks c
                JOIN documents d ON c.document_id = d.id
                WHERE d.project_id = $1
                  AND c.tsv @@ to_tsquery('simple', $2)
                ORDER BY rank DESC
                LIMIT $3
                """,
                project_id, ts_query, top_k,
            )
        except Exception as exc:
            logger.warning("BM25 search failed: %s", exc)
            return []

        chunks: list[RetrievedChunk] = []
        for row in rows:
            chunks.append(
                RetrievedChunk(
                    chunk_id=row["id"],
                    document_id=row["document_id"],
                    text=row["text"],
                    page_number=row["page_number"],
                    section=row["section"],
                    filename=row["filename"],
                    score=float(row["rank"]),
                    source="bm25",
                )
            )

        # Normalize BM25 scores to 0-1 range
        if chunks:
            max_score = max(c.score for c in chunks) or 1.0
            for c in chunks:
                c.score = c.score / max_score

        return chunks

    async def _table_search(
        self, project_id: str, query: str
    ) -> list[dict[str, Any]]:
        """Retrieve relevant structured tables."""
        if self._embed is None:
            return []

        try:
            query_embedding = await self._embed(query)
            results = await self.vector_store.query_tables(
                project_id=project_id,
                query_embedding=query_embedding,
                n_results=5,
            )
        except Exception as exc:
            logger.warning("Table search failed: %s", exc)
            return []

        tables: list[dict[str, Any]] = []
        if results and results.get("ids"):
            for i, table_id in enumerate(results["ids"][0]):
                meta = results["metadatas"][0][i] if results.get("metadatas") else {}
                tables.append({
                    "table_id": table_id,
                    "content": results["documents"][0][i] if results.get("documents") else "",
                    "metadata": meta,
                })

        return tables

    @staticmethod
    def _reciprocal_rank_fusion(
        ranked_lists: list[list[RetrievedChunk]],
        k: int = 60,
    ) -> list[RetrievedChunk]:
        """Merge multiple ranked lists using Reciprocal Rank Fusion.

        RRF score = sum(1 / (k + rank)) across all lists.
        """
        scores: dict[str, float] = {}
        chunk_map: dict[str, RetrievedChunk] = {}

        for ranked_list in ranked_lists:
            for rank, chunk in enumerate(ranked_list):
                rrf_score = 1.0 / (k + rank + 1)
                scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0) + rrf_score

                if chunk.chunk_id not in chunk_map:
                    chunk_map[chunk.chunk_id] = chunk

        # Sort by fused score
        sorted_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)

        result: list[RetrievedChunk] = []
        for cid in sorted_ids:
            chunk = chunk_map[cid]
            chunk.score = scores[cid]
            chunk.source = "fused"
            result.append(chunk)

        return result
