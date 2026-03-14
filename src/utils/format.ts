import { formatDistanceToNow, format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import type {
  ConfidenceTier,
  QuestionCategory,
  AssetClass,
  DocumentStatus,
  ProjectStatus,
} from "@/types/api";

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const locales = { de, en: enUS };

export function formatRelativeTime(
  dateStr: string,
  locale: "de" | "en" = "en"
): string {
  return formatDistanceToNow(new Date(dateStr), {
    addSuffix: true,
    locale: locales[locale],
  });
}

export function formatDate(
  dateStr: string,
  locale: "de" | "en" = "en"
): string {
  const pattern = locale === "de" ? "dd.MM.yyyy HH:mm" : "MMM d, yyyy h:mm a";
  return format(new Date(dateStr), pattern, { locale: locales[locale] });
}

// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatETA(seconds: number): string {
  if (seconds <= 0) return "--";
  return `~${formatDuration(seconds)}`;
}

// ---------------------------------------------------------------------------
// Confidence tier helpers
// ---------------------------------------------------------------------------

export const confidenceColors: Record<ConfidenceTier, string> = {
  high: "text-confidence-high",
  medium: "text-confidence-medium",
  low: "text-confidence-low",
  insufficient_data: "text-confidence-insufficient",
};

export const confidenceBgColors: Record<ConfidenceTier, string> = {
  high: "bg-green-100 dark:bg-green-900/30",
  medium: "bg-amber-100 dark:bg-amber-900/30",
  low: "bg-red-100 dark:bg-red-900/30",
  insufficient_data: "bg-slate-100 dark:bg-slate-700",
};

export const confidenceBadgeClass: Record<ConfidenceTier, string> = {
  high: "badge-green",
  medium: "badge-amber",
  low: "badge-red",
  insufficient_data: "badge-gray",
};

export const trafficLightColors: Record<"green" | "amber" | "red", string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

// ---------------------------------------------------------------------------
// File type icon mapping
// ---------------------------------------------------------------------------

export type FileIconType =
  | "pdf"
  | "word"
  | "excel"
  | "image"
  | "email"
  | "xml"
  | "cad"
  | "text"
  | "archive"
  | "presentation"
  | "unknown";

export function getFileIconType(filename: string): FileIconType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, FileIconType> = {
    pdf: "pdf",
    docx: "word",
    doc: "word",
    xlsx: "excel",
    xls: "excel",
    csv: "excel",
    png: "image",
    jpg: "image",
    jpeg: "image",
    tiff: "image",
    tif: "image",
    bmp: "image",
    eml: "email",
    msg: "email",
    xml: "xml",
    json: "xml",
    dwg: "cad",
    dxf: "cad",
    txt: "text",
    md: "text",
    rtf: "text",
    zip: "archive",
    "7z": "archive",
    rar: "archive",
    pptx: "presentation",
  };
  return map[ext] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export function getDocumentStatusColor(status: DocumentStatus): string {
  const map: Record<DocumentStatus, string> = {
    uploaded: "text-slate-400",
    detecting: "text-blue-400",
    extracting: "text-blue-500",
    chunking: "text-blue-500",
    embedding: "text-blue-500",
    indexed: "text-green-500",
    error: "text-red-500",
    skipped: "text-amber-500",
  };
  return map[status] ?? "text-slate-400";
}

export function getProjectStatusColor(status: ProjectStatus): string {
  const map: Record<ProjectStatus, string> = {
    created: "text-slate-400",
    ingesting: "text-blue-500",
    processing: "text-blue-500",
    completed: "text-green-500",
    archived: "text-slate-500",
    error: "text-red-500",
  };
  return map[status] ?? "text-slate-400";
}

// ---------------------------------------------------------------------------
// Category color mapping (for charts)
// ---------------------------------------------------------------------------

export const categoryColors: Record<QuestionCategory, string> = {
  legal_ownership: "#3b82f6",
  building_permits_zoning: "#8b5cf6",
  lease_rental: "#06b6d4",
  financial_valuation: "#10b981",
  technical_building: "#f59e0b",
  environmental: "#84cc16",
  insurance: "#f97316",
  tax: "#ef4444",
  regulatory_compliance: "#ec4899",
  disputes_litigation: "#6366f1",
  esg_sustainability: "#14b8a6",
  property_management: "#a855f7",
  capex_maintenance: "#78716c",
};

// ---------------------------------------------------------------------------
// Percentage formatting
// ---------------------------------------------------------------------------

export function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

// ---------------------------------------------------------------------------
// Asset class labels (fallback when not using i18n)
// ---------------------------------------------------------------------------

export const assetClassLabels: Record<AssetClass, string> = {
  office: "Office",
  logistics: "Logistics",
  retail: "Retail",
  residential: "Residential",
  mixed_use: "Mixed-Use",
};
