/**
 * Global keyboard shortcuts handler.
 * Maps key combinations to application actions.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store/app-store";

interface ShortcutMap {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(): void {
  const navigate = useNavigate();
  const {
    toggleLeftSidebar,
    toggleRightSidebar,
    setCommandPaletteOpen,
    theme,
    setTheme,
    language,
    setLanguage,
  } = useAppStore();

  useEffect(() => {
    const shortcuts: ShortcutMap[] = [
      {
        key: "k",
        ctrl: true,
        action: () => setCommandPaletteOpen(true),
        description: "Open command palette",
      },
      {
        key: "b",
        ctrl: true,
        action: toggleLeftSidebar,
        description: "Toggle left sidebar",
      },
      {
        key: ".",
        ctrl: true,
        action: toggleRightSidebar,
        description: "Toggle right sidebar",
      },
      {
        key: "d",
        ctrl: true,
        shift: true,
        action: () => setTheme(theme === "dark" ? "light" : "dark"),
        description: "Toggle dark/light mode",
      },
      {
        key: "l",
        ctrl: true,
        shift: true,
        action: () => setLanguage(language === "en" ? "de" : "en"),
        description: "Toggle language DE/EN",
      },
      {
        key: "1",
        ctrl: true,
        action: () => navigate("/"),
        description: "Go to Dashboard",
      },
      {
        key: "n",
        ctrl: true,
        action: () => navigate("/new-project"),
        description: "New Project",
      },
    ];

    function handleKeyDown(e: KeyboardEvent): void {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Ctrl+K even in inputs (command palette)
        if (!(e.ctrlKey && e.key === "k")) return;
      }

      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;

        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          ctrlMatch &&
          shiftMatch &&
          altMatch
        ) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    navigate,
    toggleLeftSidebar,
    toggleRightSidebar,
    setCommandPaletteOpen,
    theme,
    setTheme,
    language,
    setLanguage,
  ]);
}
