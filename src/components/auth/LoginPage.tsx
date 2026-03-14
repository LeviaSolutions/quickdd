/**
 * Login page.
 *
 * Displayed when the user has a serverUrl set but no accessToken.
 * Collects email/password and authenticates against the backend.
 */

import { useState, useCallback, type FormEvent } from "react";
import { Loader2, AlertCircle, Mail, Lock, ArrowLeft } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { login } from "@/services/auth";

export function LoginPage() {
  const serverUrl = useAppStore((s) => s.serverUrl);
  const setServerUrl = useAppStore((s) => s.setServerUrl);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogin = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) return;

      setIsLoading(true);
      setErrorMessage("");

      try {
        await login(serverUrl, trimmedEmail, password);
        // On success the store updates and App.tsx re-renders to the dashboard
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Login failed";
        setErrorMessage(message);
      } finally {
        setIsLoading(false);
      }
    },
    [email, password, serverUrl],
  );

  const handleChangeServer = useCallback(() => {
    setServerUrl("");
  }, [setServerUrl]);

  return (
    <div className="min-h-screen bg-landmark-bg flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-[0px_15px_41.6px_0px_rgba(0,0,0,0.11)] p-8">
        {/* Branding */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-[42px] h-[42px] flex items-center justify-center">
            <div className="w-[30px] h-[30px] rounded-md bg-landmark-dark rotate-45" />
          </div>
          <div className="leading-tight">
            <p className="text-[18px] font-extrabold text-landmark-dark uppercase tracking-wide leading-[1.1]">
              DD-Analyst
            </p>
            <p className="text-[14px] font-normal text-landmark-accent uppercase tracking-wide leading-[1.1]">
              Login
            </p>
          </div>
        </div>

        {/* Connected server display */}
        <div className="flex items-center justify-between mb-6 px-4 h-[38px] rounded-full bg-landmark-bg border border-landmark-grey-light">
          <span className="text-xs text-landmark-accent truncate mr-2">
            {serverUrl}
          </span>
          <button
            type="button"
            onClick={handleChangeServer}
            className="flex items-center gap-1 text-xs text-landmark-accent hover:text-landmark-dark transition-colors shrink-0"
          >
            <ArrowLeft className="w-3 h-3" />
            Change
          </button>
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Email */}
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-landmark-dark mb-1.5"
            >
              Email
            </label>
            <div className="h-[45px] rounded-full border border-landmark-grey-light bg-white/55 shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] flex items-center px-4 focus-within:ring-2 focus-within:ring-landmark-accent transition-shadow">
              <Mail className="w-4 h-4 text-[#a8a8a8] mr-3 shrink-0" />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errorMessage) setErrorMessage("");
                }}
                placeholder="name@company.com"
                className="w-full bg-transparent text-sm font-light text-landmark-dark placeholder:text-[#7e7e7e] placeholder:opacity-70 focus:outline-none caret-landmark-accent"
                autoFocus
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-landmark-dark mb-1.5"
            >
              Password
            </label>
            <div className="h-[45px] rounded-full border border-landmark-grey-light bg-white/55 shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] flex items-center px-4 focus-within:ring-2 focus-within:ring-landmark-accent transition-shadow">
              <Lock className="w-4 h-4 text-[#a8a8a8] mr-3 shrink-0" />
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage("");
                }}
                placeholder="Enter your password"
                className="w-full bg-transparent text-sm font-light text-landmark-dark placeholder:text-[#7e7e7e] placeholder:opacity-70 focus:outline-none caret-landmark-accent"
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Login button */}
          <button
            type="submit"
            disabled={!email.trim() || !password || isLoading}
            className="btn-primary w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Logging in...
              </>
            ) : (
              "Login"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
