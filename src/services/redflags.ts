/**
 * Red Flag Dashboard API operations.
 */

import { get } from "./api-client";
import type { ApiResponse, ProjectRiskOverview } from "@/types/api";

export async function getProjectRiskOverview(
  projectId: string
): Promise<ProjectRiskOverview> {
  const res = await get<ApiResponse<ProjectRiskOverview>>(
    `/api/v1/projects/${projectId}/risk-overview`
  );
  return res.data;
}
