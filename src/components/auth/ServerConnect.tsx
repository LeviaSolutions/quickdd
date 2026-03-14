/**
 * Server connection screen.
 *
 * Displayed when no serverUrl is set in the app store.
 * Lets the user enter a backend URL, verifies connectivity via /health,
 * and persists the URL on success.
 */

import { useState, useCallback, type FormEvent } from "react";
import { Loader2, Server, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { checkServerConnection } from "@/services/auth";
import { cn } from "@/utils/cn";

type ConnectionStatus = "idle" | "testing" | "connected" | "failed";

export function ServerConnect() {
  const setServerUrl = useAppStore((s) => s.setServerUrl);

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleConnect = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      const trimmed = url.trim();
      if (!trimmed) return;

      setStatus("testing");
      setErrorMessage("");

      const reachable = await checkServerConnection(trimmed);

      if (reachable) {
        setStatus("connected");
        // Brief delay so the user sees the success state before transitioning
        setTimeout(() => {
          setServerUrl(trimmed.replace(/\/+$/, ""));
        }, 400);
      } else {
        setStatus("failed");
        setErrorMessage(
          "Could not reach the server. Please check the URL and try again.",
        );
      }
    },
    [url, setServerUrl],
  );

  return (
    <div className="min-h-screen bg-landmark-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-[0px_15px_41.6px_0px_rgba(0,0,0,0.11)] p-8">
        {/* Branding */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-[42px] h-[42px] flex items-center justify-center">
            <div className="w-[30px] h-[30px] rounded-md bg-landmark-dark rotate-45" />
          </div>
          <div className="leading-tight">
            <p className="text-[18px] font-extrabold text-landmark-dark uppercase tracking-wide leading-[1.1]">
              DD-Analyst
            </p>
            <p className="text-[14px] font-normal text-landmark-accent uppercase tracking-wide leading-[1.1]">
              Server Connection
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <label
              htmlFor="server-url"
              className="block text-sm font-medium text-landmark-dark mb-1.5"
            >
              Server URL
            </label>
            <div className="h-[45px] rounded-full border border-landmark-grey-light bg-white/55 shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] flex items-center px-4 focus-within:ring-2 focus-within:ring-landmark-accent transition-shadow">
              <Server className="w-4 h-4 text-[#a8a8a8] mr-3 shrink-0" />
              <input
                id="server-url"
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (status === "failed") {
                    setStatus("idle");
                    setErrorMessage("");
                  }
                }}
                placeholder="https://dd-analyst.example.com:8000"
                className="w-full bg-transparent text-sm font-light text-landmark-dark placeholder:text-[#7e7e7e] placeholder:opacity-70 focus:outline-none caret-landmark-accent"
                autoFocus
                disabled={status === "testing" || status === "connected"}
              />
            </div>
          </div>

          {/* Status indicator */}
          {status === "testing" && (
            <div className="flex items-center gap-2 text-sm text-landmark-accent">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Testing connection...</span>
            </div>
          )}

          {status === "connected" && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              <span>Connected successfully</span>
            </div>
          )}

          {status === "failed" && errorMessage && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Connect button */}
          <button
            type="submit"
            disabled={
              !url.trim() || status === "testing" || status === "connected"
            }
            className={cn("btn-primary w-full")}
          >
            {status === "testing" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting...
              </>
            ) : status === "connected" ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Connected
              </>
            ) : (
              "Connect"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
