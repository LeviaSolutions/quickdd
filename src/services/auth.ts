/**
 * Authentication service for DD-Analyst.
 *
 * Provides login, logout, and server connection verification
 * against the FastAPI backend.
 */

import { useAppStore } from "@/store/app-store";
import { initializeApiClient } from "./api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoginUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
}

interface LoginResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly user: LoginUser;
}

interface RefreshResponse {
  readonly access_token: string;
}

// ---------------------------------------------------------------------------
// Server connectivity
// ---------------------------------------------------------------------------

/**
 * Check whether a DD-Analyst backend is reachable at the given URL.
 * Returns true only when the /health endpoint responds with HTTP 2xx
 * within 5 seconds.
 */
export async function checkServerConnection(url: string): Promise<boolean> {
  const normalizedUrl = url.replace(/\/+$/, "");
  try {
    const res = await fetch(`${normalizedUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Authenticate against the backend and persist auth state in the app store.
 * Throws on failure with a user-facing error message.
 */
export async function login(
  serverUrl: string,
  email: string,
  password: string,
): Promise<LoginResponse> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "");

  const res = await fetch(`${normalizedUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(
      (err as { detail?: string }).detail ?? "Login failed",
    );
  }

  const data: LoginResponse = await res.json();

  // Persist in store (immutable update via Zustand)
  const store = useAppStore.getState();
  store.setAuth(data.access_token, data.refresh_token, data.user);

  // Configure the shared API client for subsequent requests
  initializeApiClient(normalizedUrl, data.access_token);

  return data;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Exchange the current refresh token for a new access token.
 * Updates the store with the fresh token on success.
 */
export async function refreshAccessToken(
  serverUrl: string,
  refreshToken: string,
): Promise<string> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "");

  const res = await fetch(`${normalizedUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error("Token refresh failed");
  }

  const data: RefreshResponse = await res.json();

  // Update only the access token in the store
  const store = useAppStore.getState();
  const currentUser = store.currentUser;
  const currentRefreshToken = store.refreshToken;
  if (currentUser && currentRefreshToken) {
    store.setAuth(data.access_token, currentRefreshToken, currentUser);
  }

  initializeApiClient(normalizedUrl, data.access_token);
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * Clear all auth state from the store.
 */
export function logout(): void {
  useAppStore.getState().clearAuth();
}
