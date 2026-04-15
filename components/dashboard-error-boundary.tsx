"use client";

import { Component, type ReactNode } from "react";

export class DashboardErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: string) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error.message);
  }

  render() {
    if (this.state.error) {
      const rawMsg = this.state.error.message;
      const isDataError = rawMsg.includes("toFixed") ||
        rawMsg.includes("Cannot read properties of undefined") ||
        rawMsg.includes("Cannot read properties of null");
      const friendlyMsg = isDataError
        ? "Some data points are missing or in an unexpected format. The AI will try to fix this."
        : rawMsg;
      return (
        <div className="rounded-[var(--radius-lg)] bg-surface-high p-6">
          <p className="type-label-md text-on-surface">
            Dashboard render error
          </p>
          <p className="mt-2 text-sm text-on-surface-variant">
            {friendlyMsg}
          </p>
          <button
            type="button"
            className="mt-3 rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary shadow-ambient transition-transform hover:scale-105 active:scale-95"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
