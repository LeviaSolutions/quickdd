import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileOutput,
  Download,
  Eye,
  Upload,
  Loader2,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import { reportsApi } from "@/services";
import { useAppStore } from "@/store/app-store";
import { ProgressBar } from "../common/ProgressBar";
import { cn } from "@/utils/cn";
import type {
  ReportType,
  ReportFormat,
  ReportConfig,
  ConfidenceTier,
  QuestionCategory,
} from "@/types/api";

const REPORT_TYPES: ReportType[] = [
  "full_report",
  "executive_summary",
  "red_flags",
  "category_report",
  "qa_matrix",
  "confidence_summary",
];

const FORMATS: {
  value: ReportFormat;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "docx", label: "DOCX", icon: FileText },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "xlsx", label: "XLSX", icon: FileSpreadsheet },
];

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

const ALL_CONFIDENCE: ConfidenceTier[] = [
  "high",
  "medium",
  "low",
  "insufficient_data",
];

export function ReportExport() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);

  const [reportType, setReportType] = useState<ReportType>("full_report");
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [selectedCategories, setSelectedCategories] =
    useState<QuestionCategory[]>(ALL_CATEGORIES);
  const [selectedConfidence, setSelectedConfidence] =
    useState<ConfidenceTier[]>(ALL_CONFIDENCE);
  const [logoPath, _setLogoPath] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [secondaryColor, setSecondaryColor] = useState("#1e40af");
  const [headerText, setHeaderText] = useState("Confidential");
  const [footerText, setFooterText] = useState("");
  const [companyName, setCompanyName] = useState("");

  // Fetch templates
  useQuery({
    queryKey: ["report-templates"],
    queryFn: reportsApi.getReportTemplates,
  });

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: () => {
      const config: ReportConfig = {
        project_id: projectId!,
        report_type: reportType,
        format,
        template_id: null,
        language,
        include_categories: selectedCategories,
        include_confidence_levels: selectedConfidence,
        branding: {
          logo_path: logoPath || null,
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          header_text: headerText,
          footer_text: footerText,
          company_name: companyName,
        },
      };
      return reportsApi.generateReport(config);
    },
  });

  function toggleCategory(cat: QuestionCategory) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function toggleConfidence(tier: ConfidenceTier) {
    setSelectedConfidence((prev) =>
      prev.includes(tier) ? prev.filter((c) => c !== tier) : [...prev, tier],
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b bg-white dark:bg-slate-900 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="btn-ghost p-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <FileOutput className="w-5 h-5 text-brand-600" />
        <h2 className="text-lg font-semibold">{t("reports.title")}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Report type selection */}
          <section>
            <h3 className="text-sm font-semibold mb-3">
              {t("reports.template")}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {REPORT_TYPES.map((rt) => (
                <button
                  key={rt}
                  onClick={() => setReportType(rt)}
                  className={cn(
                    "card p-3 text-left transition-all text-sm",
                    reportType === rt
                      ? "ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/20"
                      : "hover:shadow-md",
                  )}
                >
                  {t(`reports.reportTypes.${rt}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Format selection */}
          <section>
            <h3 className="text-sm font-semibold mb-3">
              {t("reports.format")}
            </h3>
            <div className="flex items-center gap-3">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.value}
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      "card px-4 py-3 flex items-center gap-2 transition-all",
                      format === f.value
                        ? "ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/20"
                        : "hover:shadow-md",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Branding */}
          <section>
            <h3 className="text-sm font-semibold mb-3">
              {t("reports.branding")}
            </h3>
            <div className="card p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="input"
                    placeholder="Acme Real Estate GmbH"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("reports.uploadLogo")}
                  </label>
                  <button className="btn-secondary w-full text-xs">
                    <Upload className="w-3.5 h-3.5" />
                    {logoPath || t("reports.uploadLogo")}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("reports.primaryColor")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="input flex-1"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("reports.secondaryColor")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="input flex-1"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("reports.headerText")}
                  </label>
                  <input
                    type="text"
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("reports.footerText")}
                  </label>
                  <input
                    type="text"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    className="input"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Category filter */}
          <section>
            <h3 className="text-sm font-semibold mb-3">
              {t("reports.includeCategories")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-full border transition-colors",
                    selectedCategories.includes(cat)
                      ? "bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300"
                      : "border-slate-300 dark:border-slate-600 text-slate-500 hover:border-slate-400",
                  )}
                >
                  {t(`categories.${cat}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Confidence filter */}
          <section>
            <h3 className="text-sm font-semibold mb-3">
              {t("reports.includeConfidence")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {ALL_CONFIDENCE.map((tier) => (
                <button
                  key={tier}
                  onClick={() => toggleConfidence(tier)}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-full border transition-colors",
                    selectedConfidence.includes(tier)
                      ? "bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300"
                      : "border-slate-300 dark:border-slate-600 text-slate-500 hover:border-slate-400",
                  )}
                >
                  {t(`question.confidence.${tier}`)}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Footer actions */}
      <div className="shrink-0 border-t bg-white dark:bg-slate-900 px-6 py-4 flex items-center justify-end gap-3">
        {generateMutation.data && (
          <div className="flex-1">
            <ProgressBar
              value={generateMutation.data.progress_percentage}
              size="sm"
              showLabel
            />
          </div>
        )}
        <button className="btn-secondary">
          <Eye className="w-4 h-4" />
          {t("reports.preview")}
        </button>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="btn-primary"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("reports.generating")}
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              {t("reports.generate")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
