/**
 * Report generation and export API operations.
 */

import { get, post } from "./api-client";
import type {
  ApiResponse,
  ReportConfig,
  ReportGenerationStatus,
  ReportTemplate,
} from "@/types/api";

const BASE = "/api/v1/reports";

export async function getReportTemplates(): Promise<ReportTemplate[]> {
  const res = await get<ApiResponse<ReportTemplate[]>>(`${BASE}/templates`);
  return res.data;
}

export async function generateReport(
  config: ReportConfig
): Promise<ReportGenerationStatus> {
  const res = await post<ApiResponse<ReportGenerationStatus>>(
    `${BASE}/generate`,
    config
  );
  return res.data;
}

export async function getReportStatus(
  reportId: string
): Promise<ReportGenerationStatus> {
  const res = await get<ApiResponse<ReportGenerationStatus>>(
    `${BASE}/${reportId}/status`
  );
  return res.data;
}

export async function downloadReport(reportId: string): Promise<Blob> {
  const { getApiBaseUrl } = await import("./api-client");
  const response = await fetch(`${getApiBaseUrl()}${BASE}/${reportId}/download`);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }
  return response.blob();
}
