/**
 * Project-related API operations.
 */

import { get, post, del, uploadFiles } from "./api-client";
import type { Project, ProjectCreateRequest, Document } from "@/types/api";

const BASE = "/api/v1/projects";

export async function listProjects(): Promise<Project[]> {
  return get<Project[]>(BASE);
}

export async function getProject(projectId: string): Promise<Project> {
  return get<Project>(`${BASE}/${projectId}`);
}

export async function createProject(
  data: ProjectCreateRequest,
): Promise<Project> {
  return post<Project>(BASE, data);
}

export async function deleteProject(projectId: string): Promise<void> {
  await del<void>(`${BASE}/${projectId}`);
}

export async function getProjectDocuments(
  projectId: string,
): Promise<Document[]> {
  return get<Document[]>(`${BASE}/${projectId}/documents`);
}

export async function uploadProjectFiles(
  projectId: string,
  files: File[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<unknown[]> {
  return uploadFiles<unknown[]>(
    `${BASE}/${projectId}/documents`,
    files,
    undefined,
    onProgress,
  );
}

export async function uploadFolder(
  projectId: string,
  folderPath: string,
  recursive = true,
): Promise<unknown[]> {
  return post<unknown[]>(`${BASE}/${projectId}/documents/folder`, {
    folder_path: folderPath,
    recursive,
  });
}

export function startProcessing(
  projectId: string,
  questionIds?: string[],
  onProgress?: (data: unknown) => void,
  onComplete?: () => void,
  onError?: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  // Scenario count is incremented at project creation, not here.
  // Starting analysis on an existing project does not consume another scenario.
  import("./api-client").then(({ streamPost }) => {
    streamPost(
      `${BASE}/${projectId}/execute`,
      {
        project_id: projectId,
        question_ids: questionIds ?? null,
        force_rerun: false,
      },
      (chunk: unknown) => onProgress?.(chunk),
      async () => {
        onComplete?.();
      },
      (err: Error) => onError?.(err),
      controller.signal,
    );
  });

  return controller;
}

export async function stopProcessing(_projectId: string): Promise<void> {
  // TODO: implement server-side cancellation
}
