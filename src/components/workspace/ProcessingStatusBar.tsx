import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { ProgressBar } from "../common/ProgressBar";
import type { Project } from "@/types/api";

interface ProcessingStatusBarProps {
  projectId: string;
  executionProgress: { completed: number; total: number } | null;
  project: Project | null | undefined;
}

export function ProcessingStatusBar({
  executionProgress,
  project,
}: ProcessingStatusBarProps) {
  const { t } = useTranslation();

  // Determine progress from live execution data or project data
  // Use || (not ??) for total so 0 falls back to project.question_count
  const completed =
    executionProgress?.completed ?? project?.answered_count ?? 0;
  const total = (executionProgress?.total || project?.question_count) ?? 0;

  const isProcessing =
    executionProgress !== null || project?.status === "processing";

  if (!isProcessing || total === 0) {
    return null;
  }

  const percentage = Math.round((completed / total) * 100);

  return (
    <div className="shrink-0 border-b bg-blue-50 dark:bg-blue-900/10 px-4 py-2">
      <div className="flex items-center gap-3">
        <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-blue-800 dark:text-blue-300 truncate">
              {t("workspace.processingProgress")}
            </span>
          </div>
          <ProgressBar value={percentage} size="sm" showLabel />
        </div>
      </div>
    </div>
  );
}
