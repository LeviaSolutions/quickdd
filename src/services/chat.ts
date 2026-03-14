/**
 * Free Query / Chat API operations with SSE streaming support.
 */

import { get, post, streamPost } from "./api-client";
import type {
  ApiResponse,
  ChatSession,
  FreeQueryRequest,
  ChatStreamChunk,
  SaveAsQuestionRequest,
} from "@/types/api";

const BASE = "/api/v1/projects";

export async function getChatSessions(
  projectId: string
): Promise<ChatSession[]> {
  const res = await get<ApiResponse<ChatSession[]>>(
    `${BASE}/${projectId}/chat/sessions`
  );
  return res.data;
}

export async function getChatSession(
  projectId: string,
  sessionId: string
): Promise<ChatSession> {
  const res = await get<ApiResponse<ChatSession>>(
    `${BASE}/${projectId}/chat/sessions/${sessionId}`
  );
  return res.data;
}

export async function createChatSession(
  projectId: string
): Promise<ChatSession> {
  const res = await post<ApiResponse<ChatSession>>(
    `${BASE}/${projectId}/chat/sessions`
  );
  return res.data;
}

export async function deleteChatSession(
  projectId: string,
  sessionId: string
): Promise<void> {
  await post<ApiResponse<null>>(
    `${BASE}/${projectId}/chat/sessions/${sessionId}/delete`
  );
}

/**
 * Send a free query and stream the response token by token.
 * Uses POST-based SSE streaming because the request includes a body.
 */
export function sendFreeQuery(
  request: FreeQueryRequest,
  onChunk: (chunk: ChatStreamChunk) => void,
  onComplete?: () => void,
  onError?: (error: Error) => void,
  signal?: AbortSignal
): Promise<void> {
  return streamPost<ChatStreamChunk>(
    `${BASE}/${request.project_id}/chat/query`,
    request,
    onChunk,
    onComplete,
    onError,
    signal
  );
}

export async function saveMessageAsQuestion(
  projectId: string,
  data: SaveAsQuestionRequest
): Promise<void> {
  await post<ApiResponse<null>>(
    `${BASE}/${projectId}/chat/save-as-question`,
    data
  );
}
