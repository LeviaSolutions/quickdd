import { useTranslation } from "react-i18next";
import { Search, Settings, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useAppStore } from "@/store/app-store";

export function AppHeader() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { backendHealth, setCommandPaletteOpen } = useAppStore();

  return (
    <header className="h-[63px] bg-landmark-bg dark:bg-slate-900 flex items-center justify-between px-4 shrink-0">
      {/* Left: Logo + Brand + Partner */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          {/* Diamond logo */}
          <div className="w-[42px] h-[42px] flex items-center justify-center">
            <div className="w-[30px] h-[30px] rounded-md bg-landmark-dark rotate-45" />
          </div>
          {/* Brand text */}
          <div className="hidden sm:block leading-tight">
            <p className="text-[18px] font-extrabold text-landmark-dark uppercase tracking-wide leading-[1.1]">
              Landmark
            </p>
            <p className="text-[18px] font-normal text-landmark-dark uppercase tracking-wide leading-[1.1]">
              Solutions
            </p>
          </div>
        </button>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Connection indicator pill */}
        <div
          className={cn(
            "flex items-center gap-2 px-4 h-[43px] rounded-full bg-white shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)]",
          )}
        >
          <span className="text-sm text-landmark-dark">
            {backendHealth.connected
              ? t("common.connected")
              : t("common.backendDisconnected")}
          </span>
          <div
            className={cn(
              "w-[11px] h-[11px] rounded-full border-[0.5px] border-[#d0d0d0] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)]",
              backendHealth.connected ? "bg-status-green" : "bg-status-red",
            )}
          />
        </div>

        {/* Search button */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="w-[43px] h-[43px] rounded-full bg-white shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)] flex items-center justify-center hover:bg-slate-50 transition-colors"
          title={t("common.search")}
        >
          <Search className="w-5 h-5 text-landmark-dark" />
        </button>

        {/* Settings button */}
        <button
          onClick={() => navigate("/settings")}
          className="w-[43px] h-[43px] rounded-full bg-white shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)] flex items-center justify-center hover:bg-slate-50 transition-colors"
          title={t("nav.settings")}
        >
          <Settings className="w-5 h-5 text-landmark-dark" />
        </button>

        {/* User profile pill */}
        <div className="flex items-center h-[43px] rounded-full bg-white shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)] pl-4 pr-1">
          <div className="text-right mr-3">
            <p className="text-xs font-normal text-landmark-dark uppercase leading-tight">
              Max Mustermann
            </p>
            <p className="text-xs font-normal text-landmark-dark uppercase leading-tight">
              ID: DS1153246
            </p>
          </div>
          <div className="w-[43px] h-[43px] rounded-full bg-white shadow-[-5px_0px_9px_0px_rgba(0,0,0,0.04)] flex items-center justify-center">
            <User className="w-5 h-5 text-landmark-dark" />
          </div>
        </div>
      </div>
    </header>
  );
}
