/**
 * Global application state managed by Zustand.
 * Handles theme, language, backend connection status, and active project context.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HealthStatus } from "@/services/api-client";
import type { Language, Project, ProcessingProgress } from "@/types/api";
// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export type ThemeMode = "light" | "dark" | "system";

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", mode === "dark");
  }
}

// ---------------------------------------------------------------------------
// Store definition
// ---------------------------------------------------------------------------

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AppState {
  // Theme
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;

  // Language
  language: Language;
  setLanguage: (lang: Language) => void;

  // Server connection
  serverUrl: string;
  setServerUrl: (url: string) => void;

  // Auth
  accessToken: string | null;
  refreshToken: string | null;
  currentUser: CurrentUser | null;
  setAuth: (
    accessToken: string,
    refreshToken: string,
    user: CurrentUser,
  ) => void;
  clearAuth: () => void;

  // Backend connection
  backendHealth: HealthStatus;
  setBackendHealth: (health: HealthStatus) => void;

  // Active project context
  activeProject: Project | null;
  setActiveProject: (project: Project | null) => void;

  // Processing state for the active project
  processingProgress: ProcessingProgress | null;
  setProcessingProgress: (progress: ProcessingProgress | null) => void;

  // UI state
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, _get) => ({
      // Theme
      theme: "light",
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      // Language
      language: "de",
      setLanguage: (language) => set({ language }),

      // Server connection
      serverUrl: "",
      setServerUrl: (serverUrl) => set({ serverUrl }),

      // Auth
      accessToken: null,
      refreshToken: null,
      currentUser: null,
      setAuth: (accessToken, refreshToken, currentUser) =>
        set({ accessToken, refreshToken, currentUser }),
      clearAuth: () =>
        set({ accessToken: null, refreshToken: null, currentUser: null }),

      // Backend
      backendHealth: {
        connected: false,
        status: "disconnected",
        lastCheck: new Date(),
        consecutiveFailures: 0,
      },
      setBackendHealth: (backendHealth) => set({ backendHealth }),

      // Active project
      activeProject: null,
      setActiveProject: (activeProject) =>
        set({ activeProject, processingProgress: null }),

      // Processing
      processingProgress: null,
      setProcessingProgress: (processingProgress) =>
        set({ processingProgress }),

      // Sidebars
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      toggleLeftSidebar: () =>
        set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
      toggleRightSidebar: () =>
        set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
      setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
      setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),

      // Command palette
      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) =>
        set({ commandPaletteOpen }),
    }),
    {
      name: "dd-analyst-app-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        serverUrl: state.serverUrl,
        leftSidebarOpen: state.leftSidebarOpen,
        rightSidebarOpen: state.rightSidebarOpen,
      }),
    },
  ),
);

// Apply persisted theme on load
const storedTheme = useAppStore.getState().theme;
applyTheme(storedTheme);

// Listen for system theme changes
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (useAppStore.getState().theme === "system") {
      applyTheme("system");
    }
  });
