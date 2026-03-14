import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  FolderPlus,
  Settings,
  Search,
  Moon,
  Sun,
  Languages,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/utils/cn";

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  keywords: string[];
}

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    theme,
    setTheme,
    language,
    setLanguage,
  } = useAppStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands: CommandItem[] = [
    {
      id: "dashboard",
      label: t("nav.dashboard"),
      icon: <LayoutDashboard className="w-4 h-4" />,
      action: () => navigate("/"),
      keywords: ["home", "projects", "dashboard"],
    },
    {
      id: "new-project",
      label: t("dashboard.newProject"),
      icon: <FolderPlus className="w-4 h-4" />,
      action: () => navigate("/new-project"),
      keywords: ["create", "new", "project", "wizard"],
    },
    {
      id: "settings",
      label: t("nav.settings"),
      icon: <Settings className="w-4 h-4" />,
      action: () => navigate("/settings"),
      keywords: ["settings", "preferences", "config"],
    },
    {
      id: "toggle-theme",
      label: `${t("settings.theme")}: ${theme === "dark" ? "Light" : "Dark"}`,
      icon: theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
      action: () => setTheme(theme === "dark" ? "light" : "dark"),
      keywords: ["theme", "dark", "light", "mode"],
    },
    {
      id: "toggle-language",
      label: `${t("settings.language")}: ${language === "en" ? "Deutsch" : "English"}`,
      icon: <Languages className="w-4 h-4" />,
      action: () => setLanguage(language === "en" ? "de" : "en"),
      keywords: ["language", "deutsch", "english", "sprache"],
    },
  ];

  const filtered = query
    ? commands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(query.toLowerCase()) ||
          cmd.keywords.some((kw) =>
            kw.toLowerCase().includes(query.toLowerCase())
          )
      )
    : commands;

  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      cmd.action();
      setCommandPaletteOpen(false);
      setQuery("");
    },
    [setCommandPaletteOpen]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!commandPaletteOpen) return;

      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        executeCommand(filtered[selectedIndex]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    commandPaletteOpen,
    setCommandPaletteOpen,
    filtered,
    selectedIndex,
    executeCommand,
  ]);

  if (!commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setCommandPaletteOpen(false)}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-slide-up">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${t("common.search")}...`}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            autoFocus
          />
          <kbd className="text-2xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-500">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              No results found
            </p>
          ) : (
            filtered.map((cmd, index) => (
              <button
                key={cmd.id}
                onClick={() => executeCommand(cmd)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors",
                  index === selectedIndex
                    ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                )}
              >
                <span className="text-slate-500 dark:text-slate-400">
                  {cmd.icon}
                </span>
                <span>{cmd.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
