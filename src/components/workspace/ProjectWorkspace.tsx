import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ArrowLeft,
  AlertTriangle,
  MessageSquare,
  FileOutput,
  Activity,
  Play,
  Loader2,
} from "lucide-react";
import { projectsApi } from "@/services";
import { useAppStore } from "@/store/app-store";
import toast from "react-hot-toast";
import { cn } from "@/utils/cn";
import { FileSidebar } from "./FileSidebar";
import { QAPanel } from "./QAPanel";
import { DocumentPreviewPanel } from "./DocumentPreviewPanel";
import { ProcessingStatusBar } from "./ProcessingStatusBar";

type WorkspaceTab = "questions" | "redflags" | "freequery" | "reports";

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const {
    leftSidebarOpen,
    rightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
    setActiveProject,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("questions");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [highlightChunkIds, setHighlightChunkIds] = useState<string[]>([]);
  const [isLocalExecuting, setIsLocalExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  // Fetch project — poll faster during execution
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getProject(projectId!),
    enabled: !!projectId,
    refetchInterval: isLocalExecuting ? 5_000 : 15_000,
  });

  // Derive executing state from both local trigger and backend status
  const isExecuting =
    isLocalExecuting ||
    project?.status === "processing" ||
    project?.status === "ingesting";

  // Set active project in global store
  useEffect(() => {
    if (project) {
      setActiveProject(project);
    }
    return () => setActiveProject(null);
  }, [project, setActiveProject]);

  // Start AI analysis
  function handleStartAnalysis() {
    if (!projectId || isExecuting) return;
    setIsLocalExecuting(true);
    setExecutionProgress({
      completed: 0,
      total: project?.question_count ?? 0,
    });

    projectsApi.startProcessing(
      projectId,
      undefined,
      (chunk: unknown) => {
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        const data = chunk as Record<string, unknown>;
        if (data.total_questions) {
          setExecutionProgress((prev) => ({
            ...prev!,
            total: data.total_questions as number,
          }));
        }
        if (data.status === "completed" || data.status === "skipped") {
          setExecutionProgress((prev) =>
            prev ? { ...prev, completed: prev.completed + 1 } : null,
          );
        }
      },
      () => {
        setIsLocalExecuting(false);
        setExecutionProgress(null);
        toast.success(t("workspace.processingProgress") + " — done");
        // Refresh project status and Q&A data
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        queryClient.invalidateQueries({ queryKey: ["questions", projectId] });
      },
      (err) => {
        console.error("Execution error:", err);
        setIsLocalExecuting(false);
        setExecutionProgress(null);
        toast.error(String(err));
      },
    );
  }

  // Navigate to a source document
  function handleCitationClick(documentId: string, chunkIds: string[]) {
    setSelectedDocumentId(documentId);
    setHighlightChunkIds(chunkIds);
    if (!rightSidebarOpen) {
      toggleRightSidebar();
    }
  }

  const tabs: { id: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { id: "questions", label: t("workspace.questions"), icon: Activity },
    { id: "redflags", label: t("workspace.redFlags"), icon: AlertTriangle },
    { id: "freequery", label: t("workspace.freeQuery"), icon: MessageSquare },
    { id: "reports", label: t("workspace.reports"), icon: FileOutput },
  ];

  if (!projectId) {
    navigate("/");
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Project header bar */}
      <div className="shrink-0 border-b bg-white dark:bg-slate-900 px-4 py-2 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="btn-ghost p-1.5">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">
            {project?.name ?? "Loading..."}
          </h2>
          {project && (
            <p className="text-2xs text-slate-500 dark:text-slate-400">
              {t(`wizard.assetClasses.${project.asset_class}`)} &middot;{" "}
              {project.file_count} files &middot; {project.answered_count}/
              {project.question_count} questions
            </p>
          )}
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 border rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  activeTab === tab.id
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Start Analysis button */}
        <button
          onClick={handleStartAnalysis}
          disabled={isExecuting}
          className="btn-primary text-xs py-1.5 px-3"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {executionProgress
                ? `${executionProgress.completed}/${executionProgress.total}`
                : project && project.question_count > 0
                  ? `${project.answered_count}/${project.question_count}`
                  : "Starting..."}
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Start Analysis
            </>
          )}
        </button>

        {/* Sidebar toggles */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleLeftSidebar}
            className="btn-ghost p-1.5"
            title="Toggle file sidebar"
          >
            {leftSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={toggleRightSidebar}
            className="btn-ghost p-1.5"
            title="Toggle document preview"
          >
            {rightSidebarOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Processing status bar */}
      <ProcessingStatusBar
        projectId={projectId}
        executionProgress={executionProgress}
        project={project ?? null}
      />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: File tree */}
        {leftSidebarOpen && (
          <div className="w-72 border-r bg-white dark:bg-slate-900 overflow-hidden shrink-0">
            <FileSidebar projectId={projectId} />
          </div>
        )}

        {/* Center: Q&A / Red Flags / Chat / Reports */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "questions" && (
            <QAPanel
              projectId={projectId}
              onCitationClick={handleCitationClick}
            />
          )}
          {activeTab === "redflags" && (
            <div className="h-full overflow-y-auto p-6">
              {/* RedFlagDashboard is lazy-loaded in the route, but also
                  accessible as a tab within the workspace. */}
              <p className="text-sm text-slate-500">
                Red Flag Dashboard embedded view -- navigate to{" "}
                <button
                  onClick={() => navigate(`/projects/${projectId}/redflags`)}
                  className="text-brand-600 hover:underline"
                >
                  full view
                </button>
              </p>
            </div>
          )}
          {activeTab === "freequery" && (
            <div className="h-full overflow-y-auto p-6">
              <p className="text-sm text-slate-500">
                Free Query mode --{" "}
                <button
                  onClick={() => navigate(`/projects/${projectId}/chat`)}
                  className="text-brand-600 hover:underline"
                >
                  open full chat
                </button>
              </p>
            </div>
          )}
          {activeTab === "reports" && (
            <div className="h-full overflow-y-auto p-6">
              <p className="text-sm text-slate-500">
                Report Export --{" "}
                <button
                  onClick={() => navigate(`/projects/${projectId}/reports`)}
                  className="text-brand-600 hover:underline"
                >
                  open export wizard
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Right sidebar: Document preview */}
        {rightSidebarOpen && (
          <div className="w-96 border-l bg-white dark:bg-slate-900 overflow-hidden shrink-0">
            <DocumentPreviewPanel
              projectId={projectId}
              documentId={selectedDocumentId}
              highlightChunkIds={highlightChunkIds}
            />
          </div>
        )}
      </div>
    </div>
  );
}
