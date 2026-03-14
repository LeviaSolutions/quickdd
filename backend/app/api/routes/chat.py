"""Free query / chat API routes with SSE streaming."""

from __future__ import annotations

import json
import logging
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.core.auth import BearerAuth
from app.db.postgres import get_db
from app.schemas.llm import ChatCompletionResponse, ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
async def chat_completion(
    body: ChatRequest,
    request: Request,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Chat completion with RAG context.

    If ``stream=True`` (default), returns an SSE stream of token events.
    If ``stream=False``, returns the complete response as JSON.
    """
    llm_manager = request.app.state.llm_manager
    vector_store = request.app.state.vector_store

    # Get the latest user message for RAG retrieval
    user_messages = [m for m in body.messages if m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message provided")

    latest_query = user_messages[-1].content

    # Build context from RAG retrieval
    from app.services.rag.retriever import HybridRetriever

    retriever = HybridRetriever(db=db, vector_store=vector_store)
    retrieval = await retriever.retrieve(
        project_id=body.project_id,
        query=latest_query,
    )

    # Build augmented messages with context
    context_parts = []
    for chunk in retrieval.chunks:
        header = f"[Document: {chunk.filename}"
        if chunk.page_number:
            header += f", Page: {chunk.page_number}"
        header += f"]"
        context_parts.append(f"{header}\n{chunk.text}")

    context_text = "\n\n---\n\n".join(context_parts) if context_parts else ""

    augmented_messages = [
        {"role": "system", "content": (
            "You are a real estate due diligence analyst. "
            "Answer questions based on the provided document context. "
            "Always cite sources. If information is not available, say so."
        )},
    ]

    # Add conversation history (skip the latest message, we'll add it with context)
    for msg in body.messages[:-1]:
        augmented_messages.append({"role": msg.role, "content": msg.content})

    # Add latest message with RAG context
    augmented_messages.append({
        "role": "user",
        "content": f"Context:\n{context_text}\n\nQuestion: {latest_query}",
    })

    if body.stream:
        return EventSourceResponse(
            _stream_tokens(llm_manager, augmented_messages, body, retrieval)
        )

    # Non-streaming response
    config = body.config
    result = await llm_manager.generate(
        augmented_messages,
        temperature=config.temperature if config else None,
        max_tokens=config.max_tokens if config else None,
    )

    return ChatCompletionResponse(
        answer=result["text"],
        model_used=llm_manager.model_name or "unknown",
        prompt_tokens=result.get("prompt_tokens", 0),
        completion_tokens=result.get("completion_tokens", 0),
        sources=[
            {
                "filename": c.filename,
                "page": c.page_number,
                "score": round(c.score, 3),
            }
            for c in retrieval.chunks
        ],
    )


async def _stream_tokens(llm_manager, messages, body, retrieval):
    """Generator that yields SSE events for streaming token generation."""
    config = body.config

    # Send sources first
    sources = [
        {
            "filename": c.filename,
            "page": c.page_number,
            "score": round(c.score, 3),
        }
        for c in retrieval.chunks
    ]
    yield {
        "event": "sources",
        "data": json.dumps(sources),
    }

    # Stream tokens
    full_text = ""
    async for token in llm_manager.generate_stream(
        messages,
        temperature=config.temperature if config else None,
        max_tokens=config.max_tokens if config else None,
    ):
        full_text += token
        yield {
            "event": "token",
            "data": json.dumps({"token": token}),
        }

    # Final event with complete response
    yield {
        "event": "done",
        "data": json.dumps({
            "answer": full_text,
            "model": llm_manager.model_name or "unknown",
        }),
    }
