import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { router } from "@/routes";
import { useAppStore } from "@/store/app-store";
import { initializeApiClient, startHealthCheck } from "@/services/api-client";
import { UpdateChecker } from "@/components/common/UpdateChecker";
import { ServerConnect } from "@/components/auth/ServerConnect";
import { LoginPage } from "@/components/auth/LoginPage";

// Create a stable QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const isTauri = !!(window as unknown as Record<string, unknown>)
  .__TAURI_INTERNALS__;

/**
 * Root application component.
 * Configures the API client from the stored server URL and renders
 * either a connection/login placeholder or the main app.
 */
export function App() {
  const { i18n } = useTranslation();
  const language = useAppStore((s) => s.language);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const accessToken = useAppStore((s) => s.accessToken);

  // Sync i18n language with store
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  // Configure API client from store whenever serverUrl or token changes
  useEffect(() => {
    if (serverUrl) {
      initializeApiClient(serverUrl, accessToken ?? undefined);
      startHealthCheck();
    }
  }, [serverUrl, accessToken]);

  // Not connected to server yet — show connection screen
  if (!serverUrl) {
    return <ServerConnect />;
  }

  // Not authenticated — show login screen
  if (!accessToken) {
    return <LoginPage />;
  }

  // Normal app
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className:
            "!bg-white dark:!bg-slate-800 !text-slate-900 dark:!text-slate-100 !shadow-lg !border !border-slate-200 dark:!border-slate-700",
          duration: 4000,
        }}
      />
      {isTauri && <UpdateChecker />}
    </QueryClientProvider>
  );
}
