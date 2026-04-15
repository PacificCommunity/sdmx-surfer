"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { json as jsonLang } from "@codemirror/lang-json";
import {
  dashboardConfigSchema,
  formatDashboardConfigError,
} from "@/lib/dashboard-schema";
import { ConfigInspector } from "@/components/config-inspector";
import type { SDMXDashboardConfig } from "@/lib/types";

const LazyCodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="shimmer h-full w-full rounded-[var(--radius-lg)]" />,
});

export function JsonEditor({
  config,
  onApply,
}: {
  config: SDMXDashboardConfig;
  onApply: (config: SDMXDashboardConfig) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const prettyConfigText = JSON.stringify(config, null, 2);

  useEffect(() => {
    if (!dirty) {
      setText(prettyConfigText);
    }
  }, [prettyConfigText, dirty]);

  const handleChange = (value: string) => {
    setText(value);
    setDirty(true);
    try {
      const parsed = JSON.parse(value) as unknown;
      const validation = dashboardConfigSchema.safeParse(parsed);
      setParseError(
        validation.success ? null : formatDashboardConfigError(validation.error),
      );
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const validation = dashboardConfigSchema.safeParse(parsed);
      if (!validation.success) {
        setParseError(formatDashboardConfigError(validation.error));
        return;
      }
      setParseError(null);
      setDirty(false);
      setEditing(false);
      setText(JSON.stringify(validation.data, null, 2));
      onApply(validation.data as SDMXDashboardConfig);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleReset = () => {
    setText(prettyConfigText);
    setParseError(null);
    setDirty(false);
    setEditing(false);
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const validation = dashboardConfigSchema.safeParse(parsed);
      if (!validation.success) {
        setParseError(formatDashboardConfigError(validation.error));
        return;
      }
      setText(JSON.stringify(validation.data, null, 2));
      setParseError(null);
      setDirty(true);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const isPrettyFormatted = (() => {
    try {
      return text === JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return false;
    }
  })();

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between bg-surface-high/50 px-4 py-2">
        <div className="flex items-center gap-2">
          {!editing && !dirty && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ghost-border rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
            >
              Edit
            </button>
          )}
          {dirty && (
            <span className="type-label-md text-secondary">Modified</span>
          )}
          {parseError && (
            <span className="text-xs text-red-600">
              {parseError.split(" at ")[0]}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {dirty && !parseError && !isPrettyFormatted && (
            <button
              type="button"
              onClick={handleFormat}
              className="rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-secondary transition-transform hover:scale-105 active:scale-95"
            >
              Format
            </button>
          )}
          {(editing || dirty) && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
            >
              {dirty ? "Reset" : "Cancel"}
            </button>
          )}
          {dirty && (
            <button
              type="button"
              onClick={handleApply}
              disabled={!!parseError}
              className="brand-gradient rounded-full px-4 py-1 text-xs font-semibold text-on-primary shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            >
              Apply
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-surface-low p-4">
        {editing || dirty ? (
          <div
            className={
              "h-full overflow-hidden rounded-[var(--radius-lg)] bg-surface-card shadow-ambient " +
              (parseError
                ? "ring-2 ring-red-400/50"
                : dirty
                  ? "ring-2 ring-secondary/30"
                  : "")
            }
          >
            <LazyCodeMirror
              value={text}
              onChange={(val: string) => handleChange(val)}
              extensions={[jsonLang()]}
              theme="light"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: false,
              }}
              height="100%"
              style={{ height: "100%", fontSize: "12px" }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="block h-full w-full overflow-auto rounded-[var(--radius-lg)] bg-surface-card p-4 text-left shadow-ambient transition-shadow hover:shadow-none focus:outline-none"
            onClick={() => setEditing(true)}
          >
            <ConfigInspector config={config} />
          </button>
        )}
      </div>
    </div>
  );
}
