/**
 * React hook for SSE connections with automatic cleanup.
 */

import { useEffect, useRef } from "react";
import { connectSSE, type SSECallback, type SSEErrorCallback } from "@/services/api-client";
import type { SSEEventType } from "@/types/api";

interface UseSSEOptions {
  path: string;
  onEvent: SSECallback;
  onError?: SSEErrorCallback;
  eventFilter?: SSEEventType[];
  enabled?: boolean;
}

export function useSSE({
  path,
  onEvent,
  onError,
  eventFilter,
  enabled = true,
}: UseSSEOptions): { isConnected: boolean } {
  const connectionRef = useRef<ReturnType<typeof connectSSE> | null>(null);

  useEffect(() => {
    if (!enabled) {
      connectionRef.current?.close();
      connectionRef.current = null;
      return;
    }

    connectionRef.current = connectSSE(path, onEvent, onError, eventFilter);

    return () => {
      connectionRef.current?.close();
      connectionRef.current = null;
    };
    // We deliberately use the path as the primary dependency.
    // onEvent/onError may change on every render; we rely on the callbacks
    // being stable or the consumer wrapping them in useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled]);

  return {
    isConnected: connectionRef.current?.isConnected() ?? false,
  };
}
