import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function BackendDisconnectedBanner() {
  const { t } = useTranslation();

  return (
    <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2 flex items-center gap-3">
      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {t("common.backendDisconnected")}
        </p>
        <p className="text-xs text-red-600 dark:text-red-400">
          {t("common.backendDisconnectedDesc")}
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="btn-ghost text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30"
      >
        <RefreshCw className="w-4 h-4" />
        <span className="text-xs">{t("common.retry")}</span>
      </button>
    </div>
  );
}
