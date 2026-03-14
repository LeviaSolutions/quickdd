import { Outlet } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { BackendDisconnectedBanner } from "../common/BackendDisconnectedBanner";
import { CommandPalette } from "../common/CommandPalette";
import { useAppStore } from "@/store/app-store";
import { useBackendHealth } from "@/hooks/use-backend-health";

export function AppLayout() {
  useBackendHealth();
  const backendHealth = useAppStore((s) => s.backendHealth);

  return (
    <div className="h-full flex flex-col bg-landmark-bg dark:bg-surface-dark">
      <AppHeader />
      {!backendHealth.connected && <BackendDisconnectedBanner />}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}
