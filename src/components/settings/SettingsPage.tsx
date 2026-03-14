import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Settings as SettingsIcon,
  Palette,
  Users,
  Info,
  Globe,
  Sun,
  Moon,
  Monitor,
  Loader2,
} from "lucide-react";
import { settingsApi } from "@/services";
import { useAppStore, type ThemeMode } from "@/store/app-store";
import { cn } from "@/utils/cn";
import type { AppSettings, Language } from "@/types/api";

type SettingsTab = "general" | "processing" | "branding" | "users" | "about";

const TABS: { id: SettingsTab; icon: React.ElementType; labelKey: string }[] = [
  { id: "general", icon: SettingsIcon, labelKey: "settings.general" },
  { id: "processing", icon: SettingsIcon, labelKey: "settings.processing" },
  { id: "branding", icon: Palette, labelKey: "settings.branding" },
  { id: "users", icon: Users, labelKey: "settings.users" },
  { id: "about", icon: Info, labelKey: "settings.about" },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useAppStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.getSettings,
  });

  const { data: systemInfo } = useQuery({
    queryKey: ["system-info"],
    queryFn: settingsApi.getSystemInfo,
  });

  useMutation({
    mutationFn: (s: Partial<AppSettings>) => settingsApi.updateSettings(s),
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b bg-white dark:bg-slate-900 px-6 py-4">
        <h2 className="text-xl font-semibold">{t("settings.title")}</h2>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Tab sidebar */}
        <div className="w-56 border-r bg-white dark:bg-slate-900 p-3 overflow-y-auto shrink-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-medium"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800",
                )}
              >
                <Icon className="w-4 h-4" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
              </div>
            ) : (
              <>
                {activeTab === "general" && (
                  <GeneralSettings
                    theme={theme}
                    setTheme={setTheme}
                    language={language}
                    setLanguage={setLanguage}
                    t={t}
                  />
                )}
                {activeTab === "processing" && (
                  <ProcessingSettings settings={settings} t={t} />
                )}
                {activeTab === "about" && (
                  <AboutSection t={t} systemInfo={systemInfo} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General Settings
// ---------------------------------------------------------------------------

function GeneralSettings({
  theme,
  setTheme,
  language,
  setLanguage,
  t,
}: {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  language: Language;
  setLanguage: (l: Language) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const themes: { value: ThemeMode; icon: React.ElementType; label: string }[] =
    [
      { value: "light", icon: Sun, label: t("settings.themes.light") },
      { value: "dark", icon: Moon, label: t("settings.themes.dark") },
      { value: "system", icon: Monitor, label: t("settings.themes.system") },
    ];

  return (
    <div className="space-y-8">
      {/* Theme */}
      <div>
        <h3 className="text-sm font-semibold mb-3">{t("settings.theme")}</h3>
        <div className="flex items-center gap-3">
          {themes.map((th) => {
            const Icon = th.icon;
            return (
              <button
                key={th.value}
                onClick={() => setTheme(th.value)}
                className={cn(
                  "card px-4 py-3 flex items-center gap-2 transition-all",
                  theme === th.value
                    ? "ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/20"
                    : "hover:shadow-md",
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{th.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Language */}
      <div>
        <h3 className="text-sm font-semibold mb-3">{t("settings.language")}</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLanguage("en")}
            className={cn(
              "card px-4 py-3 flex items-center gap-2 transition-all",
              language === "en"
                ? "ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/20"
                : "hover:shadow-md",
            )}
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm">English</span>
          </button>
          <button
            onClick={() => setLanguage("de")}
            className={cn(
              "card px-4 py-3 flex items-center gap-2 transition-all",
              language === "de"
                ? "ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/20"
                : "hover:shadow-md",
            )}
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm">Deutsch</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing Settings
// ---------------------------------------------------------------------------

function ProcessingSettings({
  settings,
  t,
}: {
  settings?: AppSettings;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const p = settings?.processing;

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">{t("settings.processing")}</h3>
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            label: "Context Window",
            value: p?.context_window,
            suffix: " tokens",
          },
          { label: "Temperature", value: p?.temperature },
          { label: "Top-p", value: p?.top_p },
          { label: "Max Output Tokens", value: p?.max_output_tokens },
          { label: "Retrieval Top-K", value: p?.retrieval_top_k },
          { label: "Re-ranker Top-K", value: p?.reranker_top_k },
          { label: "Chunk Size", value: p?.chunk_size, suffix: " tokens" },
          {
            label: "Chunk Overlap",
            value: p?.chunk_overlap,
            suffix: " tokens",
          },
          { label: "Max Hops", value: p?.max_hops },
          { label: "Parallel Questions", value: p?.parallel_questions },
        ].map((item) => (
          <div key={item.label}>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {item.label}
            </label>
            <input
              type="number"
              defaultValue={item.value ?? ""}
              className="input"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function AboutSection({
  t: _t,
  systemInfo: _systemInfo,
}: {
  t: ReturnType<typeof useTranslation>["t"];
  systemInfo?: Awaited<ReturnType<typeof settingsApi.getSystemInfo>>;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-4">
          <span className="text-white font-bold text-2xl">DD</span>
        </div>
        <h2 className="text-xl font-bold">DD-Analyst</h2>
        <p className="text-sm text-slate-500 mt-1">
          Offline AI-Powered Real Estate Due Diligence
        </p>
        <p className="text-xs text-slate-400 mt-2">Version 1.0.0</p>
      </div>

      <div className="card p-4 text-sm space-y-2">
        <p className="text-slate-600 dark:text-slate-400">
          DD-Analyst is a standalone desktop application for automated real
          estate due diligence screening. All processing runs locally on your
          machine -- no data ever leaves your computer.
        </p>
        <p className="text-xs text-slate-400 mt-4">
          Built with Tauri 2.0, React, TypeScript, FastAPI, and Claude AI.
        </p>
      </div>
    </div>
  );
}
