import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Building2,
  Warehouse,
  ShoppingBag,
  Home,
  Layers,
} from "lucide-react";
import type { Project, AssetClass } from "@/types/api";
import { cn } from "@/utils/cn";
import { ProgressBar } from "../common/ProgressBar";
import { formatRelativeTime } from "@/utils/format";
import { useAppStore } from "@/store/app-store";

interface ProjectCardProps {
  project: Project;
  variant?: "grid" | "list";
}

const assetClassIcons: Record<AssetClass, React.ElementType> = {
  office: Building2,
  logistics: Warehouse,
  retail: ShoppingBag,
  residential: Home,
  mixed_use: Layers,
};

export function ProjectCard({ project, variant = "grid" }: ProjectCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = useAppStore((s) => s.language);
  const AssetIcon = assetClassIcons[project.asset_class];

  const isProcessing =
    project.status === "processing" || project.status === "ingesting";
  const isNew = project.status === "created";
  const isError = project.status === "error";
  const redFlagCount = project.red_flag_count ?? 0;

  const overallStatus: "green" | "yellow" | "red" = isError
    ? "red"
    : isNew || isProcessing
      ? "yellow"
      : redFlagCount > 5
        ? "red"
        : redFlagCount > 0
          ? "yellow"
          : "green";

  const statusColors = {
    green: "bg-status-green",
    yellow: "bg-status-yellow",
    red: "bg-status-red",
  };

  const statusLabels = {
    green: t("dashboard.status.completed"),
    yellow: isNew
      ? t("dashboard.status.created")
      : t("dashboard.status.processing"),
    red: t("dashboard.status.error"),
  };

  const displayDate =
    project.last_activity ?? project.updated_at ?? project.created_at;

  function handleClick() {
    navigate(`/projects/${project.id}`);
  }

  if (variant === "list") {
    return (
      <button
        onClick={handleClick}
        className="card w-full flex items-center gap-4 p-4 hover:shadow-md transition-shadow text-left"
      >
        {/* Asset icon */}
        <div className="w-[33px] h-[33px] rounded-[5px] bg-landmark-accent flex items-center justify-center shrink-0">
          <AssetIcon className="w-5 h-5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-landmark-dark uppercase truncate">
              {project.name}
            </h3>
            {/* Status dot */}
            <div
              className={cn(
                "w-[11px] h-[11px] rounded-full border-[0.5px] border-[#d0d0d0] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)]",
                statusColors[overallStatus],
              )}
            />
          </div>
          <p className="text-[9px] text-landmark-accent">
            {t(`wizard.assetClasses.${project.asset_class}`)}
          </p>
        </div>

        <div className="hidden md:flex items-center gap-6 text-[9px] text-landmark-accent shrink-0">
          <span className="flex items-center gap-1">
            {project.file_count} | {t("dashboard.totalFiles")}
          </span>
          <span>
            {project.answered_count}/{project.question_count}{" "}
            {t("dashboard.questionsAnswered")}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(displayDate, language)}
          </span>
        </div>
      </button>
    );
  }

  // Grid card variant — matches Figma design
  return (
    <button
      onClick={handleClick}
      className="card p-3 hover:shadow-md transition-shadow text-left flex flex-col gap-1 group"
    >
      {/* Top row: icon + status */}
      <div className="flex items-start justify-between">
        {/* Asset icon */}
        <div className="w-[33px] h-[33px] rounded-[5px] bg-landmark-accent flex items-center justify-center">
          <AssetIcon className="w-5 h-5 text-white" />
        </div>
        {/* Status text + dot */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-landmark-accent text-right">
            {statusLabels[overallStatus]}
          </span>
          <div
            className={cn(
              "w-[11px] h-[11px] rounded-full border-[0.5px] border-[#d0d0d0] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)]",
              statusColors[overallStatus],
            )}
          />
        </div>
      </div>

      {/* Title (address) */}
      <h3 className="text-[13px] font-medium text-landmark-dark uppercase truncate mt-1 group-hover:text-landmark-accent transition-colors">
        {project.name}
      </h3>

      {/* Category */}
      <p className="text-[9px] text-landmark-accent leading-tight">
        {t(`wizard.assetClasses.${project.asset_class}`)}
      </p>

      {/* Processing progress */}
      {isProcessing && (
        <ProgressBar
          value={project.coverage_percentage ?? 0}
          size="sm"
          showLabel
        />
      )}

      {/* Stats row with separator */}
      <div className="mt-auto pt-2">
        <div className="h-px bg-landmark-grey-light mb-2" />
        <div className="flex items-center gap-1 text-[9px] text-landmark-accent">
          <span>
            {project.file_count} | {t("dashboard.totalFiles")}
          </span>
          <span className="mx-2">
            {project.answered_count}/{project.question_count}{" "}
            {t("dashboard.questionsAnswered")}
          </span>
        </div>
        {/* Timestamp */}
        <p className="text-[9px] text-landmark-accent mt-0.5">
          {formatRelativeTime(displayDate, language)}
        </p>
      </div>
    </button>
  );
}
