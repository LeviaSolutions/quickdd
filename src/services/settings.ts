/**
 * Settings and system info API operations.
 */

import { get, put, post } from "./api-client";
import type {
  ApiResponse,
  AppSettings,
  SystemInfo,
  UserProfile,
} from "@/types/api";

export async function getSettings(): Promise<AppSettings> {
  const res = await get<ApiResponse<AppSettings>>("/api/v1/settings");
  return res.data;
}

export async function updateSettings(
  settings: Partial<AppSettings>
): Promise<AppSettings> {
  const res = await put<ApiResponse<AppSettings>>(
    "/api/v1/settings",
    settings
  );
  return res.data;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const res = await get<ApiResponse<SystemInfo>>("/api/v1/system/info");
  return res.data;
}

export async function runBenchmark(): Promise<SystemInfo> {
  const res = await post<ApiResponse<SystemInfo>>("/api/v1/system/benchmark");
  return res.data;
}

export async function getUsers(): Promise<UserProfile[]> {
  const res = await get<ApiResponse<UserProfile[]>>("/api/v1/users");
  return res.data;
}

export async function shutdownBackend(): Promise<void> {
  await post<ApiResponse<null>>("/api/v1/shutdown");
}
