import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, Shield, ExternalLink } from "lucide-react";
import { redflagsApi } from "@/services";
import { TrafficLight } from "../common/TrafficLight";
import { ConfidenceBadge } from "../common/ConfidenceBadge";
import { EmptyState } from "../common/EmptyState";
import { cn } from "@/utils/cn";
import { categoryColors } from "@/utils/format";
import type {
  CategoryRiskSummary,
  RedFlag,
  QuestionCategory,
} from "@/types/api";

export function RedFlagDashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data: riskOverview, isLoading } = useQuery({
    queryKey: ["risk-overview", projectId],
    queryFn: () => redflagsApi.getProjectRiskOverview(projectId!),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (!riskOverview || riskOverview.total_flags === 0) {
    return (
      <div className="h-full flex flex-col">
        <Header projectId={projectId!} navigate={navigate} t={t} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<Shield className="w-6 h-6" />}
            title={t("redflags.noFlags")}
            description={t("redflags.noFlagsDescription")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Header projectId={projectId!} navigate={navigate} t={t} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Overall risk score */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <OverallRiskCard
            riskScore={riskOverview.overall_risk_score}
            trafficLight={riskOverview.overall_traffic_light}
            t={t}
          />
          <StatCard
            label={t("redflags.criticalFlags")}
            value={riskOverview.critical_flags}
            color="red"
          />
          <StatCard
            label={t("redflags.totalFlags")}
            value={riskOverview.total_flags}
            color="amber"
          />
        </div>

        {/* Category breakdown */}
        <div>
          <h3 className="text-sm font-semibold mb-3">
            {t("redflags.categoryBreakdown")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {riskOverview.category_summaries.map((cat) => (
              <CategoryRiskCard key={cat.category} summary={cat} t={t} />
            ))}
          </div>
        </div>

        {/* Red flag register */}
        <div>
          <h3 className="text-sm font-semibold mb-3">
            {t("redflags.flagList")}
          </h3>
          <div className="space-y-2">
            {riskOverview.red_flags.map((flag) => (
              <RedFlagItem
                key={flag.id}
                flag={flag}
                t={t}
                onNavigate={() =>
                  navigate(
                    `/projects/${projectId}?question=${flag.question.id}`,
                  )
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({
  projectId,
  navigate,
  t,
}: {
  projectId: string;
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="shrink-0 border-b bg-white dark:bg-slate-900 px-6 py-4 flex items-center gap-3">
      <button
        onClick={() => navigate(`/projects/${projectId}`)}
        className="btn-ghost p-1.5"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <AlertTriangle className="w-5 h-5 text-red-500" />
      <h2 className="text-lg font-semibold">{t("redflags.title")}</h2>
    </div>
  );
}

function OverallRiskCard({
  riskScore,
  trafficLight,
  t,
}: {
  riskScore: number;
  trafficLight: "green" | "amber" | "red";
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div
        className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold",
          trafficLight === "green" &&
            "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
          trafficLight === "amber" &&
            "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
          trafficLight === "red" &&
            "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        )}
      >
        {riskScore.toFixed(0)}
      </div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide">
          {t("redflags.overallRisk")}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <TrafficLight status={trafficLight} size="md" />
          <span className="text-sm font-medium">
            {t(`redflags.trafficLight.${trafficLight}`)}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "red" | "amber" | "green";
}) {
  const colorClasses = {
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
    green: "text-green-600 dark:text-green-400",
  };

  return (
    <div className="card p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={cn("text-3xl font-bold mt-1", colorClasses[color])}>
        {value}
      </p>
    </div>
  );
}

function CategoryRiskCard({
  summary,
  t,
}: {
  summary: CategoryRiskSummary;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const barWidth =
    summary.max_risk_score > 0
      ? (summary.risk_score / summary.max_risk_score) * 100
      : 0;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor:
                categoryColors[summary.category as QuestionCategory] ??
                "#64748b",
            }}
          />
          <span className="text-xs font-medium">
            {t(`categories.${summary.category}`)}
          </span>
        </div>
        <TrafficLight status={summary.traffic_light} size="sm" />
      </div>

      {/* Risk bar */}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            summary.traffic_light === "green" && "bg-green-500",
            summary.traffic_light === "amber" && "bg-amber-500",
            summary.traffic_light === "red" && "bg-red-500",
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-2xs text-slate-500">
        <span>Score: {summary.risk_score.toFixed(1)}</span>
        <span>{summary.red_flag_count} flags</span>
      </div>
    </div>
  );
}

function RedFlagItem({
  flag,
  t,
  onNavigate,
}: {
  flag: RedFlag;
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: () => void;
}) {
  const language = "en"; // Would come from store

  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
              flag.severity >= 8
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : flag.severity >= 5
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
            )}
          >
            {flag.severity}
          </div>
          <span className="text-2xs text-slate-400">
            {t("redflags.severity")}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="badge-gray text-2xs">
              {t(`categories.${flag.category}`)}
            </span>
            <span className="badge-red text-2xs">
              {t(`redflags.flagType.${flag.flag_type}`)}
            </span>
          </div>
          <p className="text-sm font-medium">
            {(language as string) === "de"
              ? flag.question.question_de
              : flag.question.question_en}
          </p>
          <p className="text-xs text-slate-500 mt-1">{flag.description}</p>
          {flag.recommended_action && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Recommended: {flag.recommended_action}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <ConfidenceBadge
            tier={flag.answer.confidence_tier}
            size="sm"
            showLabel={false}
          />
          <button
            onClick={onNavigate}
            className="btn-ghost p-1 text-slate-400"
            title="Go to question"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
