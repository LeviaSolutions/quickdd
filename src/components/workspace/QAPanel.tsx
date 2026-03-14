import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Search, SlidersHorizontal } from "lucide-react";
import { questionsApi, type QuestionFilters } from "@/services/questions";
import { QuestionCard } from "../questions/QuestionCard";
import { cn } from "@/utils/cn";
import type {
  QuestionCategory,
  ConfidenceTier,
  AnswerStatus,
  QuestionPriority,
} from "@/types/api";

interface QAPanelProps {
  projectId: string;
  onCitationClick: (documentId: string, chunkIds: string[]) => void;
}

const ALL_CATEGORIES: QuestionCategory[] = [
  "legal_ownership",
  "building_permits_zoning",
  "lease_rental",
  "financial_valuation",
  "technical_building",
  "environmental",
  "insurance",
  "tax",
  "regulatory_compliance",
  "disputes_litigation",
  "esg_sustainability",
  "property_management",
  "capex_maintenance",
];

export function QAPanel({ projectId, onCitationClick }: QAPanelProps) {
  const { t } = useTranslation();

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, _setCategoryFilter] = useState<QuestionCategory | "">(
    "",
  );
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceTier | "">(
    "",
  );
  const [statusFilter, setStatusFilter] = useState<AnswerStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<QuestionPriority | "">(
    "",
  );
  const [showFilters, setShowFilters] = useState(false);
  const [activeCategory, setActiveCategory] = useState<
    QuestionCategory | "all"
  >("all");

  const filters: QuestionFilters = useMemo(
    () => ({
      category: categoryFilter || undefined,
      confidence: confidenceFilter || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      search: searchQuery || undefined,
    }),
    [
      categoryFilter,
      confidenceFilter,
      statusFilter,
      priorityFilter,
      searchQuery,
    ],
  );

  const { data: questionAnswers, isLoading } = useQuery({
    queryKey: ["questions", projectId, filters],
    queryFn: () => questionsApi.getQuestionAnswers(projectId, filters),
    refetchInterval: 10_000,
  });

  // Group by category for tab navigation
  const grouped = useMemo(() => {
    if (!questionAnswers) return {};
    return questionAnswers.reduce(
      (acc, qa) => {
        const cat = qa.question.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(qa);
        return acc;
      },
      {} as Record<string, typeof questionAnswers>,
    );
  }, [questionAnswers]);

  const displayedQAs =
    activeCategory === "all"
      ? questionAnswers
      : (grouped[activeCategory] ?? []);

  return (
    <div className="h-full flex flex-col">
      {/* Search and filter bar */}
      <div className="shrink-0 border-b bg-white dark:bg-slate-900 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("workspace.searchQuestions")}
              className="input pl-10"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "btn-ghost",
              showFilters && "bg-brand-50 dark:bg-brand-900/20 text-brand-600",
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="text-xs">{t("common.filter")}</span>
          </button>
        </div>

        {/* Expanded filter dropdowns */}
        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap animate-fade-in">
            <select
              value={confidenceFilter}
              onChange={(e) =>
                setConfidenceFilter(e.target.value as ConfidenceTier | "")
              }
              className="input text-xs py-1.5 w-auto"
            >
              <option value="">{t("workspace.allConfidence")}</option>
              <option value="high">{t("question.confidence.high")}</option>
              <option value="medium">{t("question.confidence.medium")}</option>
              <option value="low">{t("question.confidence.low")}</option>
              <option value="insufficient_data">
                {t("question.confidence.insufficient_data")}
              </option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as AnswerStatus | "")
              }
              className="input text-xs py-1.5 w-auto"
            >
              <option value="">{t("workspace.allStatus")}</option>
              <option value="pending">Pending</option>
              <option value="generating">Generating</option>
              <option value="generated">Generated</option>
              <option value="reviewed">Reviewed</option>
              <option value="overridden">Overridden</option>
              <option value="error">Error</option>
            </select>
            <select
              value={priorityFilter}
              onChange={(e) =>
                setPriorityFilter(e.target.value as QuestionPriority | "")
              }
              className="input text-xs py-1.5 w-auto"
            >
              <option value="">{t("workspace.allPriority")}</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        )}
      </div>

      {/* Category tabs (horizontal scroll) */}
      <div className="shrink-0 border-b bg-white dark:bg-slate-900 overflow-x-auto">
        <div className="flex items-center gap-1 px-4 py-1 min-w-max">
          <button
            onClick={() => setActiveCategory("all")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors",
              activeCategory === "all"
                ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300",
            )}
          >
            {t("workspace.allCategories")} ({questionAnswers?.length ?? 0})
          </button>
          {ALL_CATEGORIES.map((cat) => {
            const count = grouped[cat]?.length ?? 0;
            if (count === 0 && !categoryFilter) return null;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors",
                  activeCategory === cat
                    ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300",
                )}
              >
                {t(`categories.${cat}`)} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
          </div>
        ) : !displayedQAs || displayedQAs.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-12">
            No questions match the current filters.
          </p>
        ) : (
          displayedQAs.map((qa) => (
            <QuestionCard
              key={qa.question.id}
              projectId={projectId}
              question={qa.question}
              answer={qa.answer}
              onCitationClick={onCitationClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
