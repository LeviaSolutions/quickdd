/**
 * DD-Analyst API Client
 *
 * Handles all HTTP communication with the FastAPI backend server.
 * Supports standard REST operations and SSE streaming for LLM responses.
 *
 * The server URL and access token are provided by the app store
 * (configured via the server connection UI).
 */

import type { ApiError, SSEEvent, SSEEventType } from "@/types/api";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface ApiClientConfig {
  baseUrl: string;
  authToken: string;
  timeout: number;
  healthCheckInterval: number;
}

const DEFAULT_CONFIG: ApiClientConfig = {
  baseUrl: "",
  authToken: "",
  timeout: 30_000,
  healthCheckInterval: 5_000,
};

let config: ApiClientConfig = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the API client with the server URL and optional access token.
 * Called whenever the server URL or auth token changes in the app store.
 */
export function initializeApiClient(
  serverUrl: string,
  accessToken?: string,
): void {
  config = {
    ...config,
    baseUrl: serverUrl.replace(/\/+$/, ""),
    authToken: accessToken ?? "",
  };
}

/**
 * Configure the API client from the app store's current state.
 * Useful for re-syncing after store hydration.
 */
export function configureFromStore(): void {
  // Lazy import to avoid circular dependency at module load time
  const { useAppStore } = require("@/store/app-store");
  const store = useAppStore.getState();
  if (store.serverUrl) {
    config.baseUrl = store.serverUrl.replace(/\/+$/, "");
  }
  if (store.accessToken) {
    config.authToken = store.accessToken;
  }
}

export function getApiBaseUrl(): string {
  return config.baseUrl;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: ApiError | null = null;
    try {
      errorData = (await response.json()) as ApiError;
    } catch {
      // Response body may not be JSON
    }
    throw new ApiClientError(
      errorData?.detail ?? `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      errorData?.code ?? "UNKNOWN_ERROR",
      errorData?.detail,
    );
  }
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Core HTTP Methods
// ---------------------------------------------------------------------------

function buildHeaders(extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.authToken) {
    headers["Authorization"] = `Bearer ${config.authToken}`;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, config.baseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString();
}

export async function get<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    method: "GET",
    headers: buildHeaders(),
    signal: AbortSignal.timeout(config.timeout),
  });
  return handleResponse<T>(response);
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.timeout),
  });
  return handleResponse<T>(response);
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "PUT",
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.timeout),
  });
  return handleResponse<T>(response);
}

export async function del<T>(path: string): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "DELETE",
    headers: buildHeaders(),
    signal: AbortSignal.timeout(config.timeout),
  });
  return handleResponse<T>(response);
}

/**
 * Upload files using multipart/form-data.
 * Does NOT set Content-Type header so the browser sets the boundary automatically.
 */
export async function uploadFiles<T>(
  path: string,
  files: File[],
  extraFields?: Record<string, string>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (extraFields) {
    Object.entries(extraFields).forEach(([key, value]) =>
      formData.append(key, value),
    );
  }

  // Use XMLHttpRequest for progress tracking if callback provided
  if (onProgress) {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", buildUrl(path));
      if (config.authToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${config.authToken}`);
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded, e.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as T);
        } else {
          reject(
            new ApiClientError(
              `Upload failed: ${xhr.statusText}`,
              xhr.status,
              "UPLOAD_ERROR",
            ),
          );
        }
      };
      xhr.onerror = () =>
        reject(new ApiClientError("Upload failed", 0, "NETWORK_ERROR"));
      xhr.send(formData);
    });
  }

  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      ...(config.authToken
        ? { Authorization: `Bearer ${config.authToken}` }
        : {}),
    },
    body: formData,
  });
  return handleResponse<T>(response);
}

// ---------------------------------------------------------------------------
// Server-Sent Events (SSE) Client
// ---------------------------------------------------------------------------

export type SSECallback<T = unknown> = (event: SSEEvent<T>) => void;
export type SSEErrorCallback = (error: Error) => void;

interface SSEConnection {
  close: () => void;
  isConnected: () => boolean;
}

/**
 * Connect to an SSE endpoint for streaming events.
 *
 * Supports the DD-Analyst SSE protocol:
 *   - processing_progress: Real-time question processing updates
 *   - document_status: File processing status changes
 *   - answer_complete: Full answer available
 *   - answer_stream: Token-by-token LLM streaming
 *   - chat_stream: Free query chat streaming
 *   - error: Backend error events
 *   - health: Periodic health pings
 *
 * @param path  SSE endpoint path (e.g., "/api/v1/projects/{id}/events")
 * @param onEvent  Callback for each SSE event
 * @param onError  Callback for connection errors
 * @param eventFilter  Optional list of event types to listen for
 * @returns SSEConnection with close() and isConnected()
 */
export function connectSSE(
  path: string,
  onEvent: SSECallback,
  onError?: SSEErrorCallback,
  eventFilter?: SSEEventType[],
): SSEConnection {
  let isActive = true;
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const BASE_RETRY_DELAY = 1000;
  let eventSource: EventSource | null = null;

  function connect() {
    const url = buildUrl(path, {
      ...(config.authToken ? { token: config.authToken } : {}),
      ...(eventFilter ? { events: eventFilter.join(",") } : {}),
    });

    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      retryCount = 0; // Reset on successful connection
    };

    eventSource.onmessage = (event: MessageEvent) => {
      if (!isActive) return;
      try {
        const parsed: SSEEvent = JSON.parse(event.data as string);
        if (!eventFilter || eventFilter.includes(parsed.event)) {
          onEvent(parsed);
        }
      } catch (e) {
        console.error("Failed to parse SSE event:", e, event.data);
      }
    };

    // Handle named events (FastAPI can send typed events)
    const eventTypes: SSEEventType[] = eventFilter ?? [
      "processing_progress",
      "document_status",
      "answer_complete",
      "answer_stream",
      "chat_stream",
      "error",
      "health",
    ];

    eventTypes.forEach((eventType) => {
      eventSource?.addEventListener(eventType, ((event: MessageEvent) => {
        if (!isActive) return;
        try {
          const data = JSON.parse(event.data as string);
          onEvent({ event: eventType, data, id: event.lastEventId });
        } catch (e) {
          console.error(`Failed to parse SSE ${eventType} event:`, e);
        }
      }) as EventListener);
    });

    eventSource.onerror = () => {
      if (!isActive) return;

      eventSource?.close();

      if (retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount - 1);
        setTimeout(() => {
          if (isActive) connect();
        }, delay);
      } else {
        onError?.(new Error("SSE connection failed after maximum retries"));
      }
    };
  }

  connect();

  return {
    close: () => {
      isActive = false;
      eventSource?.close();
    },
    isConnected: () => isActive && eventSource?.readyState === EventSource.OPEN,
  };
}

/**
 * Stream a chat/query response using fetch + ReadableStream for SSE.
 * This is used for endpoints that require POST (e.g., free query with a body).
 *
 * Uses the fetch API with streaming instead of EventSource because
 * EventSource only supports GET requests.
 */
export async function streamPost<T>(
  path: string,
  body: unknown,
  onChunk: (chunk: T) => void,
  onComplete?: () => void,
  onError?: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch(buildUrl(path), {
      method: "POST",
      headers: {
        ...buildHeaders(),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new ApiClientError(
        `Stream request failed: ${response.statusText}`,
        response.status,
        "STREAM_ERROR",
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines from the buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep the incomplete last line in the buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            onComplete?.();
            return;
          }
          try {
            const parsed = JSON.parse(data) as T;
            onChunk(parsed);
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }

    onComplete?.();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return; // User-initiated abort, not an error
    }
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export interface HealthStatus {
  connected: boolean;
  status: "ok" | "degraded" | "error" | "disconnected";
  lastCheck: Date;
  consecutiveFailures: number;
}

type HealthListener = (status: HealthStatus) => void;

let healthInterval: ReturnType<typeof setInterval> | null = null;
const healthListeners: Set<HealthListener> = new Set();
let currentHealth: HealthStatus = {
  connected: false,
  status: "disconnected",
  lastCheck: new Date(),
  consecutiveFailures: 0,
};

export function startHealthCheck(): void {
  if (healthInterval) return;

  async function check() {
    try {
      const data = await get<{ status: string }>("/health");
      currentHealth = {
        connected: true,
        status: data.status as HealthStatus["status"],
        lastCheck: new Date(),
        consecutiveFailures: 0,
      };
    } catch {
      currentHealth = {
        connected: currentHealth.consecutiveFailures < 2,
        status:
          currentHealth.consecutiveFailures >= 2 ? "disconnected" : "degraded",
        lastCheck: new Date(),
        consecutiveFailures: currentHealth.consecutiveFailures + 1,
      };
    }
    healthListeners.forEach((listener) => listener(currentHealth));
  }

  check(); // Immediately check
  healthInterval = setInterval(check, config.healthCheckInterval);
}

export function stopHealthCheck(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

export function onHealthChange(listener: HealthListener): () => void {
  healthListeners.add(listener);
  // Immediately fire with current state
  listener(currentHealth);
  return () => healthListeners.delete(listener);
}

export function getHealthStatus(): HealthStatus {
  return currentHealth;
}
