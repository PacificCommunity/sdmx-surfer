"use client";

import { useEffect, useState } from "react";

interface PublishDialogProps {
  open: boolean;
  busy?: boolean;
  initialAuthorDisplayName?: string | null;
  initialPublicTitle?: string | null;
  initialPublicDescription?: string | null;
  suggestedTitle?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    authorDisplayName: string;
    publicTitle: string;
    publicDescription: string;
  }) => Promise<void> | void;
}

export function PublishDialog({
  open,
  busy = false,
  initialAuthorDisplayName,
  initialPublicTitle,
  initialPublicDescription,
  suggestedTitle,
  onClose,
  onSubmit,
}: PublishDialogProps) {
  const [authorDisplayName, setAuthorDisplayName] = useState("");
  const [publicTitle, setPublicTitle] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAuthorDisplayName(initialAuthorDisplayName ?? "");
    setPublicTitle(initialPublicTitle ?? suggestedTitle ?? "");
    setPublicDescription(initialPublicDescription ?? "");
    setError("");
  }, [
    initialAuthorDisplayName,
    initialPublicDescription,
    initialPublicTitle,
    open,
    suggestedTitle,
  ]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    const nextAuthor = authorDisplayName.trim();
    const nextTitle = publicTitle.trim();
    const nextDescription = publicDescription.trim();

    if (nextAuthor.length < 2) {
      setError("Author name must be at least 2 characters.");
      return;
    }
    if (nextTitle.length < 3) {
      setError("Public title must be at least 3 characters.");
      return;
    }
    if (nextDescription.length > 500) {
      setError("Description must be 500 characters or fewer.");
      return;
    }

    setError("");
    await onSubmit({
      authorDisplayName: nextAuthor,
      publicTitle: nextTitle,
      publicDescription: nextDescription,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-primary/10 backdrop-blur-sm"
        aria-label="Close publish dialog"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="ghost-border shadow-ambient relative z-10 w-full max-w-xl rounded-[var(--radius-2xl)] bg-surface-card p-6">
        <div className="mb-5">
          <p className="type-label-md text-on-tertiary-fixed-variant">
            Public Sharing
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-on-surface">
            Publish dashboard
          </h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Choose the public title, author credit, and description that will
            appear on the shared page and gallery. Emails are never exposed.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-on-surface">
              Author name
            </span>
            <input
              type="text"
              value={authorDisplayName}
              onChange={(event) => setAuthorDisplayName(event.target.value)}
              placeholder="Pacific Data Team"
              maxLength={80}
              className="focus-architectural ghost-border w-full rounded-[var(--radius-md)] bg-surface-low px-4 py-3 text-sm text-on-surface transition-colors placeholder:text-text-muted hover:bg-surface-high"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-on-surface">
              Public title
            </span>
            <input
              type="text"
              value={publicTitle}
              onChange={(event) => setPublicTitle(event.target.value)}
              placeholder="Population Trends in Melanesia"
              maxLength={140}
              className="focus-architectural ghost-border w-full rounded-[var(--radius-md)] bg-surface-low px-4 py-3 text-sm text-on-surface transition-colors placeholder:text-text-muted hover:bg-surface-high"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-on-surface">
              Description
            </span>
            <textarea
              value={publicDescription}
              onChange={(event) => setPublicDescription(event.target.value)}
              placeholder="Describe what this dashboard covers and why it is useful."
              maxLength={500}
              rows={4}
              className="focus-architectural ghost-border w-full resize-none rounded-[var(--radius-md)] bg-surface-low px-4 py-3 text-sm text-on-surface transition-colors placeholder:text-text-muted hover:bg-surface-high"
            />
            <p className="mt-1 text-right text-[11px] text-on-surface-variant">
              {publicDescription.length}/500
            </p>
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ghost-border rounded-full px-4 py-2 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className="brand-gradient rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
