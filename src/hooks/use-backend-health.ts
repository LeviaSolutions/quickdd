/**
 * Hook that monitors backend health and updates the global store.
 * Should be mounted once at the app root level.
 */

import { useEffect } from "react";
import {
  startHealthCheck,
  stopHealthCheck,
  onHealthChange,
} from "@/services/api-client";
import { useAppStore } from "@/store/app-store";

export function useBackendHealth(): void {
  const setBackendHealth = useAppStore((s) => s.setBackendHealth);

  useEffect(() => {
    startHealthCheck();
    const unsubscribe = onHealthChange((status) => {
      setBackendHealth(status);
    });

    return () => {
      unsubscribe();
      stopHealthCheck();
    };
  }, [setBackendHealth]);
}
