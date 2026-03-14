import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Search, Plus } from "lucide-react";
import { projectsApi } from "@/services";
import { ProjectCard } from "./ProjectCard";
import { EmptyState } from "../common/EmptyState";
import { cn } from "@/utils/cn";

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.listProjects,
    refetchInterval: 10_000,
  });

  const filtered = projects?.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 px-10 pt-6 pb-4">
        {/* Title */}
        <h2 className="text-2xl font-medium text-landmark-dark uppercase tracking-wide mb-4">
          {t("dashboard.title")}
        </h2>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative w-[296px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a8a8a8]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("dashboard.searchPlaceholder")}
                className="input pl-10"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex items-center h-[30px] rounded-full bg-white shadow-[0px_4px_2.8px_0px_rgba(0,0,0,0.02)] overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "h-full px-3 flex items-center justify-center transition-colors",
                  viewMode === "grid"
                    ? "text-landmark-dark"
                    : "text-[#a8a8a8] hover:text-landmark-dark",
                )}
              >
                {/* Grid icon: 4 squares */}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect
                    x="0"
                    y="0"
                    width="5"
                    height="5"
                    stroke="currentColor"
                    strokeWidth="0.84"
                    fill="none"
                  />
                  <rect
                    x="7"
                    y="0"
                    width="5"
                    height="5"
                    stroke="currentColor"
                    strokeWidth="0.84"
                    fill="none"
                  />
                  <rect
                    x="7"
                    y="7"
                    width="5"
                    height="5"
                    stroke="currentColor"
                    strokeWidth="0.84"
                    fill="none"
                  />
                  <rect
                    x="0"
                    y="7"
                    width="5"
                    height="5"
                    stroke="currentColor"
                    strokeWidth="0.84"
                    fill="none"
                  />
                </svg>
              </button>
              {/* Separator */}
              <div className="w-px h-[17px] bg-[#a8a8a8] rotate-0" />
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "h-full px-3 flex items-center justify-center transition-colors",
                  viewMode === "list"
                    ? "text-landmark-dark"
                    : "text-[#a8a8a8] hover:text-landmark-dark",
                )}
              >
                {/* List icon: 4 horizontal lines */}
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <line
                    x1="0"
                    y1="1"
                    x2="13"
                    y2="1"
                    stroke="currentColor"
                    strokeWidth="0.84"
                  />
                  <line
                    x1="0"
                    y1="4.5"
                    x2="13"
                    y2="4.5"
                    stroke="currentColor"
                    strokeWidth="0.84"
                  />
                  <line
                    x1="0"
                    y1="8"
                    x2="13"
                    y2="8"
                    stroke="currentColor"
                    strokeWidth="0.84"
                  />
                  <line
                    x1="0"
                    y1="11.5"
                    x2="13"
                    y2="11.5"
                    stroke="currentColor"
                    strokeWidth="0.84"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* New Project button */}
          <button
            onClick={() => navigate("/new-project")}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            {t("dashboard.newProject")}
          </button>
        </div>
      </div>

      {/* Separator line */}
      <div className="mx-10 h-px bg-landmark-grey-light" />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-10 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-landmark-accent" />
          </div>
        ) : error ? (
          <EmptyState
            icon={<span className="text-lg">!</span>}
            title={t("common.error")}
            description={error instanceof Error ? error.message : String(error)}
          />
        ) : !filtered || filtered.length === 0 ? (
          <EmptyState
            icon={<FolderPlus className="w-6 h-6" />}
            title={
              searchQuery ? "No matching projects" : t("dashboard.noProjects")
            }
            description={
              searchQuery
                ? "Try adjusting your search."
                : t("dashboard.noProjectsDescription")
            }
            action={
              !searchQuery && (
                <button
                  onClick={() => navigate("/new-project")}
                  className="btn-primary"
                >
                  <Plus className="w-4 h-4" />
                  {t("dashboard.newProject")}
                </button>
              )
            }
          />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {filtered.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((project) => (
              <ProjectCard key={project.id} project={project} variant="list" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
