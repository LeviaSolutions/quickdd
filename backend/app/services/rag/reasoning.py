"""Multi-hop reasoning engine for compound DD questions.

Implements the multi-hop pipeline from the blueprint:
  1. Decompose compound question into sub-questions
  2. Retrieve and answer each sub-question independently
  3. Synthesize a final answer from intermediate results
  4. Detect contradictions between intermediate answers
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.services.llm.manager import LLMManager
from app.services.rag.retriever import HybridRetriever, RetrievalResult

logger = logging.getLogger(__name__)


@dataclass
class IntermediateAnswer:
    """An answer to a sub-question in a multi-hop chain."""

    sub_question: str
    answer_text: str
    retrieval: RetrievalResult
    hop_number: int


@dataclass
class ReasoningResult:
    """Complete result from multi-hop reasoning."""

    final_answer: str = ""
    intermediate_answers: list[IntermediateAnswer] = field(default_factory=list)
    hop_count: int = 0
    contradictions: list[dict[str, Any]] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0


DECOMPOSE_PROMPT = """You are a real estate due diligence analyst. Given the following compound question, decompose it into {max_hops} or fewer independent sub-questions that can each be answered from a document collection.

Question: {question}

Output ONLY a numbered list of sub-questions, one per line. Do not include explanations.
"""

SYNTHESIZE_PROMPT = """You are a real estate due diligence analyst. Based on the following intermediate answers to sub-questions, provide a comprehensive synthesized answer to the main question.

Main Question: {question}

Intermediate Answers:
{intermediate_context}

Instructions:
- Synthesize a single, coherent answer from all intermediate findings.
- Cite the specific source documents for each claim using [Document: filename, Page: N] format.
- If intermediate answers contradict each other, explicitly flag the contradiction.
- Provide a confidence assessment (HIGH / MEDIUM / LOW / INSUFFICIENT DATA).
- Answer in the same language as the question.
"""


class MultiHopReasoner:
    """Execute multi-hop reasoning for compound DD questions."""

    def __init__(
        self,
        retriever: HybridRetriever,
        llm: LLMManager,
    ):
        self.retriever = retriever
        self.llm = llm

    async def reason(
        self,
        project_id: str,
        question: str,
        *,
        max_hops: int | None = None,
        include_tables: bool = False,
        system_prompt: str | None = None,
    ) -> ReasoningResult:
        """Run multi-hop reasoning on a compound question.

        Args:
            project_id: UUID of the project.
            question: The compound DD question.
            max_hops: Maximum sub-questions (default from settings).
            include_tables: Whether to include structured table retrieval.
            system_prompt: Optional system prompt override.
        """
        max_hops = max_hops or settings.max_hop_depth
        result = ReasoningResult()

        # Step 1: Decompose the question into sub-questions
        sub_questions = await self._decompose(question, max_hops)
        logger.info(
            "Decomposed question into %d sub-questions: %s",
            len(sub_questions),
            sub_questions,
        )

        if not sub_questions:
            # Not a compound question — single-hop retrieval
            sub_questions = [question]

        # Step 2: Answer each sub-question independently
        for hop_num, sub_q in enumerate(sub_questions, start=1):
            retrieval = await self.retriever.retrieve(
                project_id=project_id,
                query=sub_q,
                include_tables=include_tables,
            )

            # Build context from retrieved chunks
            context = self._build_context(retrieval)

            # Generate answer for sub-question
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({
                "role": "user",
                "content": (
                    f"Context:\n{context}\n\n"
                    f"Question: {sub_q}\n\n"
                    f"Answer the question based ONLY on the provided context. "
                    f"Cite sources using [Document: filename, Page: N] format. "
                    f"If the context does not contain enough information, say so."
                ),
            })

            gen_result = await self.llm.generate(messages)

            intermediate = IntermediateAnswer(
                sub_question=sub_q,
                answer_text=gen_result["text"],
                retrieval=retrieval,
                hop_number=hop_num,
            )
            result.intermediate_answers.append(intermediate)
            result.prompt_tokens += gen_result.get("prompt_tokens", 0)
            result.completion_tokens += gen_result.get("completion_tokens", 0)

        result.hop_count = len(result.intermediate_answers)

        # Step 3: Synthesize final answer
        if len(result.intermediate_answers) > 1:
            result.final_answer = await self._synthesize(
                question, result.intermediate_answers
            )
        elif result.intermediate_answers:
            result.final_answer = result.intermediate_answers[0].answer_text

        # Step 4: Contradiction detection
        if len(result.intermediate_answers) > 1:
            result.contradictions = await self._detect_contradictions(
                question, result.intermediate_answers
            )

        return result

    async def _decompose(
        self, question: str, max_hops: int
    ) -> list[str]:
        """Use the LLM to decompose a compound question."""
        messages = [
            {
                "role": "user",
                "content": DECOMPOSE_PROMPT.format(
                    question=question, max_hops=max_hops
                ),
            },
        ]

        gen_result = await self.llm.generate(
            messages, max_tokens=512, temperature=0.0
        )

        # Parse numbered list
        lines = gen_result["text"].strip().split("\n")
        sub_questions: list[str] = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Remove numbering
            import re
            cleaned = re.sub(r"^\d+[\.\)]\s*", "", line)
            if cleaned:
                sub_questions.append(cleaned)

        return sub_questions[:max_hops]

    async def _synthesize(
        self,
        question: str,
        intermediates: list[IntermediateAnswer],
    ) -> str:
        """Synthesize a final answer from intermediate results."""
        context_parts: list[str] = []
        for ia in intermediates:
            context_parts.append(
                f"Sub-question {ia.hop_number}: {ia.sub_question}\n"
                f"Answer: {ia.answer_text}\n"
            )

        messages = [
            {
                "role": "user",
                "content": SYNTHESIZE_PROMPT.format(
                    question=question,
                    intermediate_context="\n".join(context_parts),
                ),
            },
        ]

        gen_result = await self.llm.generate(messages)
        return gen_result["text"]

    async def _detect_contradictions(
        self,
        question: str,
        intermediates: list[IntermediateAnswer],
    ) -> list[dict[str, Any]]:
        """Check for contradictions between intermediate answers."""
        if len(intermediates) < 2:
            return []

        answers_text = "\n".join(
            f"Answer {ia.hop_number} (to: {ia.sub_question}): {ia.answer_text}"
            for ia in intermediates
        )

        messages = [
            {
                "role": "user",
                "content": (
                    f"Analyze the following answers for contradictions.\n\n"
                    f"{answers_text}\n\n"
                    f"List any contradictions found. For each contradiction:\n"
                    f"- State which answers conflict\n"
                    f"- Describe the specific discrepancy\n"
                    f"- Rate severity (HIGH/MEDIUM/LOW)\n\n"
                    f"If no contradictions exist, respond with 'NO CONTRADICTIONS'."
                ),
            },
        ]

        gen_result = await self.llm.generate(messages, max_tokens=1024)
        response = gen_result["text"]

        if "NO CONTRADICTIONS" in response.upper():
            return []

        # Return as a single contradiction entry (parsing the LLM output
        # into structured data is done at the answer-storage layer)
        return [{"description": response, "severity": "medium"}]

    @staticmethod
    def _build_context(retrieval: RetrievalResult) -> str:
        """Format retrieved chunks into a context string."""
        parts: list[str] = []

        for chunk in retrieval.chunks:
            header = f"[Document: {chunk.filename}"
            if chunk.page_number:
                header += f", Page: {chunk.page_number}"
            if chunk.section:
                header += f", Section: {chunk.section}"
            header += f", Relevance: {chunk.score:.2f}]"
            parts.append(f"{header}\n{chunk.text}")

        for table in retrieval.tables:
            parts.append(f"[Table Data]\n{table.get('content', '')}")

        return "\n\n---\n\n".join(parts) if parts else "[No relevant context found]"
