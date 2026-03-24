import { useCallback, useRef, useState } from "react";
import type { SDMXDashboardConfig } from "./types";

const MAX_HISTORY = 50;

export interface ConfigHistory {
  current: SDMXDashboardConfig | null;
  canUndo: boolean;
  canRedo: boolean;
  push: (config: SDMXDashboardConfig) => void;
  undo: () => SDMXDashboardConfig | null;
  redo: () => SDMXDashboardConfig | null;
  /** Get full history + pointer for persistence */
  snapshot: () => { history: SDMXDashboardConfig[]; pointer: number };
  /** Restore from persisted state */
  restore: (history: SDMXDashboardConfig[], pointer: number) => void;
}

export function useConfigHistory(): ConfigHistory {
  const historyRef = useRef<SDMXDashboardConfig[]>([]);
  const pointerRef = useRef(-1);
  const lastJsonRef = useRef("");

  // We use a counter to force re-renders when undo/redo happens
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick((n) => n + 1), []);

  const push = useCallback(
    (config: SDMXDashboardConfig) => {
      const json = JSON.stringify(config);
      if (json === lastJsonRef.current) return;
      lastJsonRef.current = json;

      // Truncate any forward history
      historyRef.current = historyRef.current.slice(0, pointerRef.current + 1);
      historyRef.current.push(config);

      // Cap size
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY);
      }

      pointerRef.current = historyRef.current.length - 1;
      tick();
    },
    [tick],
  );

  const undo = useCallback((): SDMXDashboardConfig | null => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    const config = historyRef.current[pointerRef.current];
    lastJsonRef.current = JSON.stringify(config);
    tick();
    return config;
  }, [tick]);

  const redo = useCallback((): SDMXDashboardConfig | null => {
    if (pointerRef.current >= historyRef.current.length - 1) return null;
    pointerRef.current += 1;
    const config = historyRef.current[pointerRef.current];
    lastJsonRef.current = JSON.stringify(config);
    tick();
    return config;
  }, [tick]);

  const snapshot = useCallback(() => {
    return {
      history: historyRef.current,
      pointer: pointerRef.current,
    };
  }, []);

  const restore = useCallback(
    (history: SDMXDashboardConfig[], pointer: number) => {
      historyRef.current = history;
      pointerRef.current = Math.min(pointer, history.length - 1);
      if (pointerRef.current >= 0) {
        lastJsonRef.current = JSON.stringify(
          historyRef.current[pointerRef.current],
        );
      }
      tick();
    },
    [tick],
  );

  const current =
    pointerRef.current >= 0
      ? historyRef.current[pointerRef.current]
      : null;

  return {
    current,
    canUndo: pointerRef.current > 0,
    canRedo: pointerRef.current < historyRef.current.length - 1,
    push,
    undo,
    redo,
    snapshot,
    restore,
  };
}
