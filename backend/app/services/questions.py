"""Question catalogue loading, dependency resolution, and execution engine.

Handles:
  - Loading question catalogues from JSON files
  - Filtering by asset class
  - Topological sort for dependency resolution
  - Priority-based execution ordering
  - Incremental re-processing detection
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import asyncpg

from app.core.config import settings
from app.schemas.common import AssetClass

logger = logging.getLogger(__name__)


def _parse_json_field(value: Any) -> Any:
    """Parse a JSON field that may already be a Python object (JSONB) or a string."""
    if isinstance(value, str):
        return json.loads(value)
    return value if value is not None else []


class QuestionCatalogueService:
    """Load, filter, and manage the predefined question catalogue."""

    def __init__(self, db: asyncpg.Connection):
        self.db = db

    async def load_catalogue(self, language: str = "de") -> int:
        """Load all question JSON files into the database.

        Returns the total number of questions loaded.
        """
        questions_dir = settings.questions_dir
        if not questions_dir.exists():
            logger.warning("Questions directory not found: %s", questions_dir)
            return 0

        total = 0
        for json_file in questions_dir.glob(f"*-{language}.json"):
            count = await self._load_file(json_file)
            total += count
            logger.info("Loaded %d questions from %s", count, json_file.name)

        # Also load custom questions
        custom_file = questions_dir / "custom-questions.json"
        if custom_file.exists():
            count = await self._load_file(custom_file)
            total += count

        return total

    async def _load_file(self, json_file: Path) -> int:
        """Load questions from a single JSON file."""
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error("Failed to parse %s: %s", json_file, exc)
            return 0

        questions = data if isinstance(data, list) else data.get("questions", [])
        count = 0

        for q in questions:
            try:
                await self.db.execute(
                    """INSERT INTO questions
                       (id, category, subcategory, asset_classes_json,
                        question_de, question_en, expected_format,
                        search_keywords_de, search_keywords_en,
                        priority, source_hint, llm_instruction,
                        validation_rule, depends_on_json, severity_weight,
                        regulatory_reference, requires_table_qa,
                        multi_hop_required)
                       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb,
                               $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18)
                       ON CONFLICT (id) DO UPDATE SET
                        category = EXCLUDED.category,
                        subcategory = EXCLUDED.subcategory,
                        asset_classes_json = EXCLUDED.asset_classes_json,
                        question_de = EXCLUDED.question_de,
                        question_en = EXCLUDED.question_en,
                        expected_format = EXCLUDED.expected_format,
                        search_keywords_de = EXCLUDED.search_keywords_de,
                        search_keywords_en = EXCLUDED.search_keywords_en,
                        priority = EXCLUDED.priority,
                        source_hint = EXCLUDED.source_hint,
                        llm_instruction = EXCLUDED.llm_instruction,
                        validation_rule = EXCLUDED.validation_rule,
                        depends_on_json = EXCLUDED.depends_on_json,
                        severity_weight = EXCLUDED.severity_weight,
                        regulatory_reference = EXCLUDED.regulatory_reference,
                        requires_table_qa = EXCLUDED.requires_table_qa,
                        multi_hop_required = EXCLUDED.multi_hop_required""",
                    q["question_id"],
                    q["category"],
                    q.get("subcategory"),
                    json.dumps(q.get("asset_classes", [])),
                    q["question_de"],
                    q["question_en"],
                    q["expected_format"],
                    json.dumps(q.get("search_keywords_de", [])),
                    json.dumps(q.get("search_keywords_en", [])),
                    q.get("priority", "medium"),
                    q.get("source_hint"),
                    q.get("llm_instruction"),
                    q.get("validation_rule"),
                    json.dumps(q.get("depends_on", [])),
                    q.get("severity_weight", 5),
                    q.get("regulatory_reference"),
                    bool(q.get("requires_table_qa")),
                    bool(q.get("multi_hop_required")),
                )
                count += 1
            except Exception as exc:
                logger.warning(
                    "Failed to insert question %s: %s",
                    q.get("question_id"),
                    exc,
                )

        return count

    async def get_questions_for_asset_class(
        self, asset_class: AssetClass
    ) -> list[dict[str, Any]]:
        """Return all questions applicable to a given asset class,
        ordered by dependency resolution and priority.
        """
        rows = await self.db.fetch(
            "SELECT * FROM questions"
        )

        # Filter by asset class
        applicable: list[dict[str, Any]] = []
        for row in rows:
            asset_classes = _parse_json_field(row["asset_classes_json"])
            if asset_class.value in asset_classes or not asset_classes:
                applicable.append(dict(row))

        # Topological sort by dependencies
        return self._topological_sort(applicable)

    @staticmethod
    def _topological_sort(
        questions: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Sort questions respecting depends_on constraints.

        Uses Kahn's algorithm for topological ordering.
        Within each level, questions are sorted by priority.
        """
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}

        q_map = {q["id"]: q for q in questions}
        q_ids = set(q_map.keys())

        # Build adjacency and in-degree
        in_degree: dict[str, int] = defaultdict(int)
        dependents: dict[str, list[str]] = defaultdict(list)

        for q in questions:
            deps = _parse_json_field(q.get("depends_on_json", []))
            for dep_id in deps:
                if dep_id in q_ids:
                    dependents[dep_id].append(q["id"])
                    in_degree[q["id"]] += 1
            if q["id"] not in in_degree:
                in_degree[q["id"]] = 0

        # Start with questions that have no dependencies
        queue: deque[str] = deque(
            sorted(
                [qid for qid in q_ids if in_degree[qid] == 0],
                key=lambda qid: priority_order.get(
                    q_map[qid]["priority"], 2
                ),
            )
        )

        result: list[dict[str, Any]] = []
        while queue:
            qid = queue.popleft()
            result.append(q_map[qid])

            for dep_id in sorted(
                dependents[qid],
                key=lambda did: priority_order.get(
                    q_map[did]["priority"], 2
                ),
            ):
                in_degree[dep_id] -= 1
                if in_degree[dep_id] == 0:
                    queue.append(dep_id)

        # Add any remaining questions (circular deps — should not happen)
        remaining = q_ids - {q["id"] for q in result}
        for qid in remaining:
            result.append(q_map[qid])
            logger.warning("Question %s has unresolved dependencies", qid)

        return result
