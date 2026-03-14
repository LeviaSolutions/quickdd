import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  FileText,
  Edit3,
  CheckCircle,
  AlertTriangle,
  Clock,
  Loader2,
  GitBranch,
} from "lucide-react";
import type { Question, Answer, AnswerSource } from "@/types/api";
import { ConfidenceBadge } from "../common/ConfidenceBadge";
import { cn } from "@/utils/cn";
import { useAppStore } from "@/store/app-store";
interface QuestionCardProps {
  projectId: string;
  question: Question;
  answer: Answer | null;
  onCitationClick: (documentId: string, chunkIds: string[]) => void;
}

export function QuestionCard({
  projectId: _projectId,
  question,
  answer,
  onCitationClick,
}: QuestionCardProps) {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const [expanded, setExpanded] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideText, setOverrideText] = useState("");

  const questionText =
    language === "de" ? question.question_de : question.question_en;

  const isProcessing = answer?.status === "generating";
  const isPendingReview =
    question.priority === "critical" && answer?.status === "generated";
  const isOverridden = answer?.status === "overridden";
  const hasContradictions =
    answer?.contradictions && answer.contradictions.length > 0;

  // Priority indicator
  const priorityColors: Record<string, string> = {
    critical: "border-l-red-500",
    high: "border-l-amber-500",
    medium: "border-l-blue-500",
    low: "border-l-slate-300 dark:border-l-slate-600",
  };

  return (
    <div
      className={cn(
        "card border-l-4 overflow-hidden transition-shadow hover:shadow-md",
        priorityColors[question.priority],
      )}
    >
      {/* Main row */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Question content */}
          <div className="flex-1 min-w-0">
            {/* Category & priority badges */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-2xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                {question.id}
              </span>
              <span className="text-2xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                {t(`categories.${question.category}`)}
              </span>
              {question.priority === "critical" && (
                <span className="badge-red text-2xs">Critical</span>
              )}
              {question.multi_hop_required && (
                <span className="badge-gray text-2xs flex items-center gap-1">
                  <GitBranch className="w-3 h-3" /> Multi-hop
                </span>
              )}
            </div>

            {/* Question text */}
            <h4 className="text-sm font-medium leading-snug">{questionText}</h4>

            {/* Answer */}
            {answer ? (
              <div className="mt-2">
                {isProcessing ? (
                  <div className="flex items-center gap-2 text-sm text-blue-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="animate-stream">Wird verarbeitet...</span>
                  </div>
                ) : (
                  <>
                    {/* Short answer (always visible) */}
                    <p
                      className={cn(
                        "text-sm leading-relaxed",
                        isOverridden &&
                          "text-blue-700 dark:text-blue-400 italic",
                        answer.confidence_tier === "insufficient_data" &&
                          "text-slate-400 italic",
                      )}
                    >
                      {answer.short_answer ||
                        answer.answer_text?.split("\n")[0] ||
                        answer.answer_text}
                    </p>

                    {/* "Lange Analyse" toggle — only show if full text differs from short */}
                    {answer.answer_text &&
                      answer.answer_text !==
                        (answer.short_answer ||
                          answer.answer_text?.split("\n")[0]) &&
                      answer.confidence_tier !== "insufficient_data" && (
                        <button
                          onClick={() => setExpanded(!expanded)}
                          className="mt-1.5 text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          {expanded ? "Kurzansicht" : "Lange Analyse"}
                        </button>
                      )}

                    {/* Full answer (expandable) */}
                    {expanded && (
                      <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 animate-fade-in">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                          {answer.answer_text}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Source citations */}
                {answer.sources && answer.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {answer.sources.slice(0, 5).map((source) => (
                      <SourceCitation
                        key={source.id}
                        source={source}
                        onClick={() =>
                          onCitationClick(source.document_id, [
                            source.chunk_id ?? "",
                          ])
                        }
                      />
                    ))}
                    {answer.sources.length > 5 && (
                      <span className="text-2xs text-slate-400">
                        +{answer.sources.length - 5}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Ausstehend</span>
              </div>
            )}
          </div>

          {/* Right: confidence + actions */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            {answer && !isProcessing && (
              <ConfidenceBadge
                tier={answer.confidence_tier}
                score={answer.confidence_score}
              />
            )}

            {/* Status badges */}
            {isPendingReview && (
              <span className="badge-amber text-2xs flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t("question.reviewRequired")}
              </span>
            )}
            {isOverridden && (
              <span className="badge-gray text-2xs flex items-center gap-1">
                <Edit3 className="w-3 h-3" />
                {t("question.overridden")}
              </span>
            )}
            {hasContradictions && (
              <span className="badge-red text-2xs flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t("question.contradictions")}
              </span>
            )}

            {/* Expand toggle for metadata section */}
            {answer && !isProcessing && (
              <button
                onClick={() => setShowOverrideForm(!showOverrideForm)}
                className="btn-ghost p-1 text-slate-400"
                title="Details"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && answer && (
        <div className="border-t bg-slate-50/50 dark:bg-slate-800/50 p-4 space-y-4 animate-fade-in">
          {/* Full reasoning */}
          {answer.reasoning_trace && (
            <div>
              <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {t("question.expandReasoning")}
              </h5>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {answer.reasoning_trace}
              </p>
            </div>
          )}

          {/* Multi-hop intermediate answers */}
          {answer.intermediate_answers &&
            answer.intermediate_answers.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {t("question.hops", {
                    count: answer.intermediate_answers.length,
                  })}
                </h5>
                <div className="space-y-2">
                  {answer.intermediate_answers.map((ia, i) => (
                    <div
                      key={i}
                      className="pl-3 border-l-2 border-brand-300 dark:border-brand-600"
                    >
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Hop {ia.hop_number}: {ia.sub_question}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {ia.answer}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Contradictions */}
          {answer.contradictions && answer.contradictions.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">
                {t("question.contradictions")}
              </h5>
              {answer.contradictions.map((c) => (
                <div
                  key={c.id}
                  className="bg-red-50 dark:bg-red-900/10 rounded-lg p-3 text-xs mb-2"
                >
                  <p className="font-medium text-red-800 dark:text-red-300 mb-1">
                    {c.description}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-red-700 dark:text-red-400">
                    <div>
                      <p className="font-medium">
                        {c.source_a_document} (p.{c.source_a_page})
                      </p>
                      <p className="opacity-80">{c.source_a_text}</p>
                    </div>
                    <div>
                      <p className="font-medium">
                        {c.source_b_document} (p.{c.source_b_page})
                      </p>
                      <p className="opacity-80">{c.source_b_text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-4 text-2xs text-slate-400">
            <span>Model: {answer.model_used}</span>
            {answer.hop_count > 1 && (
              <span>{t("question.hops", { count: answer.hop_count })}</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setShowOverrideForm(!showOverrideForm)}
              className="btn-secondary text-xs"
            >
              <Edit3 className="w-3.5 h-3.5" />
              {t("question.override")}
            </button>
            {isPendingReview && (
              <button className="btn-primary text-xs">
                <CheckCircle className="w-3.5 h-3.5" />
                {t("question.signoff")}
              </button>
            )}
          </div>

          {/* Override form */}
          {showOverrideForm && (
            <div className="pt-2 animate-fade-in">
              <textarea
                value={overrideText}
                onChange={(e) => setOverrideText(e.target.value)}
                placeholder="Enter your corrected answer..."
                className="input min-h-[80px] text-sm"
                rows={3}
              />
              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  onClick={() => setShowOverrideForm(false)}
                  className="btn-ghost text-xs"
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="btn-primary text-xs"
                  disabled={!overrideText.trim()}
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Citation link
// ---------------------------------------------------------------------------

function SourceCitation({
  source,
  onClick,
}: {
  source: AnswerSource;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-md
                 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400
                 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
      title={`${source.document_filename}, page ${source.page_number}${source.section ? `, ${source.section}` : ""}\nRelevance: ${(source.relevance_score * 100).toFixed(0)}%`}
    >
      <FileText className="w-3 h-3" />
      <span className="truncate max-w-[120px]">{source.document_filename}</span>
      <span className="text-blue-500">p.{source.page_number}</span>
    </button>
  );
}
