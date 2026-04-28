"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppFooter } from "@/components/app-footer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Provider = "anthropic" | "openai" | "google" | "mistral";

interface KeyRecord {
  provider: Provider;
  modelPreference: string | null;
  updatedAt: string | null;
}

interface ProviderConfig {
  id: Provider;
  name: string;
  badge: string;
  models: string[];
  placeholder: string;
}

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

const PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    badge: "Claude",
    models: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-6"],
    placeholder: "sk-ant-...",
  },
  {
    id: "openai",
    name: "OpenAI",
    badge: "GPT",
    models: ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-5.4"],
    placeholder: "sk-...",
  },
  {
    id: "google",
    name: "Google",
    badge: "Gemini",
    models: ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-pro-preview"],
    placeholder: "AIza...",
  },
  {
    id: "mistral",
    name: "Mistral",
    badge: "Mistral",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest",
      "ministral-8b-latest",
    ],
    placeholder: "sk-...",
  },
];

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  config: ProviderConfig;
  keyRecord: KeyRecord | undefined;
  onSave: (provider: Provider, apiKey: string, modelPreference: string) => Promise<void>;
  onRemove: (provider: Provider) => Promise<void>;
}

function ProviderCard({ config, keyRecord, onSave, onRemove }: ProviderCardProps) {
  const [apiKey, setApiKey] = useState("");
  const [modelPreference, setModelPreference] = useState(
    keyRecord?.modelPreference ?? config.models[0],
  );
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  // Sync model preference when keyRecord changes
  useEffect(() => {
    setModelPreference(keyRecord?.modelPreference ?? config.models[0]);
  }, [keyRecord, config.models]);

  const isConfigured = Boolean(keyRecord);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setConfirmation("");
    try {
      await onSave(config.id, apiKey.trim(), modelPreference);
      setApiKey("");
      setConfirmation("Key saved");
      setTimeout(() => setConfirmation(""), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(config.id);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="ghost-border shadow-ambient rounded-[var(--radius-lg)] bg-surface-card p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]">
            <span className="text-xs font-bold text-white">{config.badge.slice(0, 2)}</span>
          </div>
          <div>
            <h3 className="type-headline-sm text-on-surface">{config.name}</h3>
            <p className="type-label-md text-on-surface-variant">{config.badge} models</p>
          </div>
        </div>

        {isConfigured ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Configured
          </span>
        ) : (
          <span className="rounded-full bg-surface-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
            No key
          </span>
        )}
      </div>

      {/* Model preference */}
      <div className="mb-4">
        <label
          htmlFor={"model-" + config.id}
          className="type-label-md mb-1.5 block text-on-surface-variant"
        >
          Model preference
        </label>
        <select
          id={"model-" + config.id}
          value={modelPreference}
          onChange={(e) => setModelPreference(e.target.value)}
          className="focus-architectural ghost-border w-full rounded-[var(--radius-sm)] bg-surface-low px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-high"
        >
          {config.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      {/* API key input */}
      <div className="mb-4">
        <label
          htmlFor={"key-" + config.id}
          className="type-label-md mb-1.5 block text-on-surface-variant"
        >
          API key
          {isConfigured && (
            <span className="ml-2 font-normal normal-case text-on-surface-variant">
              (leave blank to keep existing)
            </span>
          )}
        </label>
        <input
          id={"key-" + config.id}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config.placeholder}
          autoComplete="off"
          className="focus-architectural ghost-border w-full rounded-[var(--radius-sm)] bg-surface-low px-3 py-2 text-sm text-on-surface transition-colors placeholder:text-text-muted hover:bg-surface-high"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !apiKey.trim()}
          className="brand-gradient flex-1 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save key"}
        </button>

        {isConfigured && (
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={removing}
            className="ghost-border rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {removing ? "Removing..." : "Remove"}
          </button>
        )}

        {confirmation && (
          <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {confirmation}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch existing keys on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/keys");
        if (!res.ok) {
          setError("Failed to load key settings");
          return;
        }
        const data = (await res.json()) as { keys: KeyRecord[] };
        setKeys(data.keys);
      } catch {
        setError("Network error — please refresh");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(provider: Provider, apiKey: string, modelPreference: string) {
    const res = await fetch("/api/settings/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, modelPreference }),
    });
    if (!res.ok) throw new Error("Save failed");

    // Refresh keys list
    const refreshRes = await fetch("/api/settings/keys");
    if (refreshRes.ok) {
      const data = (await refreshRes.json()) as { keys: KeyRecord[] };
      setKeys(data.keys);
    }
  }

  async function handleRemove(provider: Provider) {
    const res = await fetch("/api/settings/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    if (!res.ok) throw new Error("Remove failed");

    setKeys((prev) => prev.filter((k) => k.provider !== provider));
  }

  function getKeyRecord(provider: Provider): KeyRecord | undefined {
    return keys.find((k) => k.provider === provider);
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Glass header */}
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="ghost-border flex h-9 w-9 items-center justify-center rounded-full bg-surface-card text-on-surface-variant transition-transform hover:scale-105 hover:text-primary"
            title="Back"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div>
            <h1 className="type-headline-sm text-on-surface">Settings</h1>
            <p className="type-label-md text-on-surface-variant">API key management</p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Free tier notice */}
        <div className="ghost-border mb-8 rounded-[var(--radius-lg)] bg-surface-card p-4">
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-container">
                <svg className="h-4 w-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </div>
            </div>
            <p className="text-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">Free tier uses Claude Sonnet 4.6.</span>
              {" "}Add your own API key for alternative models or higher rate limits.
            </p>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="shimmer ghost-border h-48 rounded-[var(--radius-lg)]"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider.id}
                config={provider}
                keyRecord={getKeyRecord(provider.id)}
                onSave={handleSave}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
        <AppFooter />
      </main>
    </div>
  );
}
