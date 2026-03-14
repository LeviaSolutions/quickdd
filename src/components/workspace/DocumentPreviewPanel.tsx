import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { questionsApi } from "@/services/questions";
import { EmptyState } from "../common/EmptyState";

interface DocumentPreviewPanelProps {
  projectId: string;
  documentId: string | null;
  highlightChunkIds: string[];
}

export function DocumentPreviewPanel({
  projectId,
  documentId,
  highlightChunkIds,
}: DocumentPreviewPanelProps) {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(0);

  const { data: preview, isLoading } = useQuery({
    queryKey: ["document-preview", projectId, documentId, highlightChunkIds],
    queryFn: () =>
      questionsApi.getDocumentPreview(
        projectId,
        documentId!,
        highlightChunkIds,
      ),
    enabled: !!documentId,
  });

  if (!documentId) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          title={t("workspace.noDocumentSelected")}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
      </div>
    );
  }

  const pages = preview?.pages ?? [];
  const page = pages[currentPage];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b">
        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {t("workspace.preview")}
        </h3>
        <p className="text-sm font-medium truncate mt-1">{preview?.filename}</p>
      </div>

      {/* Page navigation */}
      {pages.length > 1 && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b text-xs">
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="btn-ghost p-1 disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-slate-500">
            {t("common.page")} {currentPage + 1} {t("common.of")} {pages.length}
          </span>
          <button
            onClick={() =>
              setCurrentPage(Math.min(pages.length - 1, currentPage + 1))
            }
            disabled={currentPage === pages.length - 1}
            className="btn-ghost p-1 disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Document content */}
      <div className="flex-1 overflow-y-auto p-4">
        {page ? (
          <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300">
            {renderHighlightedText(page.text_content, page.highlights)}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No content available.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Render text with highlighted passages from chunk matches.
 */
function renderHighlightedText(
  text: string,
  highlights: { start_offset: number; end_offset: number }[],
): React.ReactNode {
  if (!highlights.length) return text;

  const sorted = [...highlights].sort(
    (a, b) => a.start_offset - b.start_offset,
  );
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  sorted.forEach((h, i) => {
    if (h.start_offset > lastEnd) {
      parts.push(text.slice(lastEnd, h.start_offset));
    }
    parts.push(
      <mark
        key={i}
        className="bg-yellow-200 dark:bg-yellow-800/50 rounded px-0.5"
      >
        {text.slice(h.start_offset, h.end_offset)}
      </mark>,
    );
    lastEnd = h.end_offset;
  });

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return parts;
}
