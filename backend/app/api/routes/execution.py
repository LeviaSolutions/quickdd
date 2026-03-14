"""Question execution engine API — runs DD questions against project docs."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.core.auth import BearerAuth
from app.core.config import settings
from app.core.operation_token import verify_operation_token
from app.db.postgres import get_db
from app.schemas.questions import QuestionExecutionRequest
from app.services.processing.page_images import build_vision_content

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/execute", tags=["execution"]
)


@router.post("")
async def execute_questions(
    project_id: str,
    body: QuestionExecutionRequest,
    request: Request,
    _auth: BearerAuth,
    db: Annotated[asyncpg.Connection, Depends(get_db)],
):
    """Execute DD questions against project documents.

    Returns an SSE stream of progress events.
    """
    # Verify operation token (signed IPC from Rust host)
    await verify_operation_token(request)

    # Verify project
    project_row = await db.fetchrow(
        "SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    if not project_row:
        raise HTTPException(status_code=404, detail="Project not found")

    project = dict(project_row)

    # Determine which questions to run — prefer junction table
    from app.services.questions import QuestionCatalogueService
    from app.schemas.common import AssetClass

    catalogue = QuestionCatalogueService(db)
    all_questions = await catalogue.get_questions_for_asset_class(
        AssetClass(project["asset_class"])
    )

    # Check junction table for selected questions
    pq_rows = await db.fetch(
        "SELECT question_id FROM project_questions WHERE project_id = $1",
        project_id,
    )
    selected_ids = {row["question_id"] for row in pq_rows} if pq_rows else None

    if body.question_ids:
        # Explicit question IDs in the request take priority
        questions = [q for q in all_questions if q["id"] in body.question_ids]
    elif selected_ids:
        # Use junction table selection
        questions = [q for q in all_questions if q["id"] in selected_ids]
    else:
        # Legacy fallback: all questions for asset class
        questions = all_questions

    if not questions:
        raise HTTPException(status_code=400, detail="No questions to execute")

    return EventSourceResponse(
        _execute_stream(
            project_id=project_id,
            questions=questions,
            project=project,
            llm_manager=request.app.state.llm_manager,
            vector_store=request.app.state.vector_store,
            force_rerun=body.force_rerun,
        )
    )


async def _execute_stream(
    project_id: str,
    questions: list[dict[str, Any]],
    project: dict[str, Any],
    llm_manager,
    vector_store,
    force_rerun: bool,
):
    """SSE generator that executes questions one by one."""
    from app.services.rag.retriever import HybridRetriever
    from app.services.rag.reasoning import MultiHopReasoner
    from app.services.rag.prompts import build_qa_prompt
    from app.db.postgres import get_pool

    # Acquire our own connection — the request's connection is released before streaming starts
    pool = await get_pool()
    db = await pool.acquire()
    try:
        retriever = HybridRetriever(db=db, vector_store=vector_store)
        reasoner = MultiHopReasoner(retriever=retriever, llm=llm_manager)

        total = len(questions)
        language = project.get("language", "de")

        # Mark project as processing
        await db.execute(
            """UPDATE projects SET status = 'processing',
                  updated_at = now()
               WHERE id = $1""",
            project_id,
        )

        yield {
            "event": "start",
            "data": json.dumps({"total_questions": total}),
        }

        for idx, question in enumerate(questions):
            q_id = question["id"]
            progress = (idx + 1) / total

            # Check if already answered (skip unless force_rerun)
            if not force_rerun:
                existing = await db.fetchrow(
                    "SELECT id FROM answers WHERE project_id = $1 AND question_id = $2",
                    project_id, q_id,
                )
                if existing:
                    yield {
                        "event": "progress",
                        "data": json.dumps({
                            "question_id": q_id,
                            "status": "skipped",
                            "progress": progress,
                            "message": "Already answered",
                        }),
                    }
                    continue

            yield {
                "event": "progress",
                "data": json.dumps({
                    "question_id": q_id,
                    "status": "running",
                    "progress": progress,
                    "message": f"Processing question {idx + 1}/{total}",
                }),
            }

            try:
                q_text = question["question_de"] if language == "de" else question["question_en"]
                multi_hop = bool(question.get("multi_hop_required", False))
                include_tables = bool(question.get("requires_table_qa", False))

                if multi_hop:
                    # Multi-hop reasoning
                    result = await reasoner.reason(
                        project_id=project_id,
                        question=q_text,
                        include_tables=include_tables,
                    )
                    answer_text = result.final_answer
                    hop_count = result.hop_count
                    prompt_tokens = result.prompt_tokens
                    completion_tokens = result.completion_tokens
                    sources_data = []
                    for ia in result.intermediate_answers:
                        for chunk in ia.retrieval.chunks:
                            sources_data.append(chunk)
                else:
                    # Single-hop retrieval + generation
                    retrieval = await retriever.retrieve(
                        project_id=project_id,
                        query=q_text,
                        include_tables=include_tables,
                    )
                    sources_data = retrieval.chunks

                    if not sources_data:
                        no_data_msg = (
                            "Keine Daten vorhanden."
                            if language == "de"
                            else "No data available."
                        )
                        answer_text = no_data_msg
                        hop_count = 1
                        prompt_tokens = 0
                        completion_tokens = 0
                    else:
                        context = "\n\n".join(
                            f"[{c.filename}, S.{c.page_number}] {c.text}"
                            for c in sources_data
                        )

                        page_images = _load_page_images_for_chunks(sources_data)
                        relevant_pages = sorted(
                            {c.page_number for c in sources_data if c.page_number}
                        )

                        if page_images and relevant_pages:
                            from app.services.rag.prompts import (
                                get_system_prompt,
                                FORMAT_INSTRUCTIONS_DE,
                                FORMAT_INSTRUCTIONS_EN,
                                QA_PROMPT_TEMPLATE_DE,
                                QA_PROMPT_TEMPLATE_EN,
                            )
                            fmt_map = FORMAT_INSTRUCTIONS_DE if language == "de" else FORMAT_INSTRUCTIONS_EN
                            template = QA_PROMPT_TEMPLATE_DE if language == "de" else QA_PROMPT_TEMPLATE_EN
                            format_instruction = fmt_map.get(question["expected_format"], "")
                            additional = question.get("llm_instruction") or ""
                            user_text = template.format(
                                context=context, question=q_text,
                                format_instruction=format_instruction,
                                additional_instruction=additional,
                            )
                            vision_content = build_vision_content(user_text, page_images, relevant_pages)
                            system_prompt = get_system_prompt(language, vision=True)
                            messages = [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": vision_content},
                            ]
                        else:
                            messages = build_qa_prompt(
                                question=q_text, context=context,
                                expected_format=question["expected_format"],
                                llm_instruction=question.get("llm_instruction"),
                                language=language,
                            )

                        gen_result = await llm_manager.generate(messages)
                        answer_text = gen_result["text"]
                        hop_count = 1
                        prompt_tokens = gen_result.get("prompt_tokens", 0)
                        completion_tokens = gen_result.get("completion_tokens", 0)

                # Compute confidence
                confidence_score = _compute_confidence(sources_data)
                confidence_tier = _tier_from_score(confidence_score)

                raw_output = answer_text
                answer_text = _clean_llm_output(answer_text)

                answer_id = str(uuid.uuid4())
                await db.execute(
                    """INSERT INTO answers
                       (id, project_id, question_id, answer_text,
                        confidence_tier, confidence_score, hop_count,
                        model_used, prompt_tokens, completion_tokens,
                        raw_llm_output, status)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'generated')""",
                    answer_id, project_id, q_id, answer_text,
                    confidence_tier, confidence_score, hop_count,
                    llm_manager.model_name or "unknown",
                    prompt_tokens, completion_tokens,
                    raw_output,
                )

                for rank, chunk in enumerate(sources_data[:8]):
                    await db.execute(
                        """INSERT INTO answer_sources
                           (id, answer_id, chunk_id, relevance_score, rank_position)
                           VALUES ($1, $2, $3, $4, $5)""",
                        str(uuid.uuid4()), answer_id, chunk.chunk_id, chunk.score, rank,
                    )

                await db.execute(
                    """UPDATE projects SET
                          answered_count = (SELECT COUNT(*) FROM answers WHERE project_id = $1),
                          updated_at = now()
                       WHERE id = $1""",
                    project_id,
                )

                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "question_id": q_id,
                        "status": "completed",
                        "progress": progress,
                        "confidence": confidence_tier,
                    }),
                }

            except Exception as exc:
                logger.error("Question %s execution failed: %s", q_id, exc)
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "question_id": q_id,
                        "status": "error",
                        "progress": progress,
                        "message": str(exc),
                    }),
                }

        # Update project counters and mark as completed
        await db.execute(
            """UPDATE projects SET
                  status = 'completed',
                  answered_count = (SELECT COUNT(*) FROM answers WHERE project_id = $1),
                  updated_at = now()
               WHERE id = $1""",
            project_id,
        )

        yield {
            "event": "done",
            "data": json.dumps({"status": "completed"}),
        }
    finally:
        await pool.release(db)


def _load_page_images_for_chunks(sources_data) -> dict[int, str]:
    """Load page images for the pages referenced by retrieved chunks.

    Reads base64-encoded page images from disk that were stored during
    document processing.  Returns a mapping of page_number -> base64 PNG.
    """
    page_images: dict[int, str] = {}
    images_base = Path(settings.data_dir) / "page_images"

    for chunk in sources_data:
        if not chunk.page_number:
            continue
        doc_images_dir = images_base / str(chunk.document_id)
        img_file = doc_images_dir / f"page_{chunk.page_number}.b64"
        if img_file.exists() and chunk.page_number not in page_images:
            page_images[chunk.page_number] = img_file.read_text()

    return page_images


def _compute_confidence(sources) -> float:
    """Compute a confidence score from retrieval sources.

    Uses the number and quality of retrieved sources:
      - Having sources at all provides a base confidence
      - More sources increase confidence
      - Higher BM25/fusion scores increase confidence
    """
    if not sources:
        return 0.0
    scores = [s.score for s in sources if hasattr(s, "score")]
    if not scores:
        return 0.0

    n = len(scores)
    top_score = max(scores)

    # Base confidence: having relevant sources
    base = 0.3 if n >= 1 else 0.0
    # Boost for number of sources (up to +0.3 for 5+ sources)
    count_boost = min(n / 5.0, 1.0) * 0.3
    # Boost for quality of best source (up to +0.4)
    quality_boost = min(top_score, 1.0) * 0.4

    return min(base + count_boost + quality_boost, 1.0)


def _tier_from_score(score: float) -> str:
    """Map a confidence score to a tier label."""
    from app.core.config import settings
    if score >= settings.confidence_high_threshold:
        return "high"
    elif score >= settings.confidence_medium_threshold:
        return "medium"
    elif score >= settings.confidence_low_threshold:
        return "low"
    return "insufficient_data"


def _clean_llm_output(text: str) -> str:
    """Strip unwanted artifacts from LLM output.

    Removes:
      - Confidence assessment lines the LLM insists on adding
      - Markdown bold/heading markers
      - Trailing "Antwort:" labels
    """
    import re

    # Remove confidence / Konfidenz lines (various patterns)
    text = re.sub(
        r"(?m)^\s*\**\s*(?:Konfidenz[\s-]*Einsch.tzung|Confidence[\s-]*[Aa]ssessment|Konfidenz)\s*:?\s*\**\s*"
        r"(?:HOCH|MITTEL|NIEDRIG|UNZUREICHEND\w*|HIGH|MEDIUM|LOW|INSUFFICIENT\w*).*$",
        "",
        text,
    )
    # Remove standalone confidence tier words on their own line
    text = re.sub(
        r"(?m)^\s*\**\s*(?:HOCH|MITTEL|NIEDRIG|HIGH|MEDIUM|LOW)\s*\**\s*$",
        "",
        text,
    )
    # Remove trailing "Antwort:" label the LLM sometimes repeats
    text = re.sub(r"(?m)^\s*Antwort:\s*$", "", text)

    # Strip markdown bold ** and headings ##
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"^#{1,4}\s+", "", text, flags=re.MULTILINE)

    # Collapse multiple blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
