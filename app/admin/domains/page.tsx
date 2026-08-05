"use client";

import { useCallback, useEffect, useState } from "react";

interface DomainRow {
  domain: string;
  organisation: string | null;
  note: string | null;
  created_at: string | null;
}

/**
 * Institutional domains admitted without an invite.
 *
 * The widest-reaching control in the admin panel: one row lets everyone at an
 * organisation sign in. The copy says so plainly, because the screen otherwise
 * looks like the invite list, where a row admits one person.
 */
export default function AdminDomainsPage() {
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [domain, setDomain] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/domains");
    if (r.ok) setRows((await r.json()).domains ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/admin/domains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, organisation: organisation || undefined }),
    });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setError(body.error ?? "Could not add that domain.");
      return;
    }
    setDomain("");
    setOrganisation("");
    void load();
  }

  async function remove(d: string) {
    await fetch("/api/admin/domains?domain=" + encodeURIComponent(d), {
      method: "DELETE",
    });
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="type-headline-sm mb-1 text-on-surface">
        Institutional domains
      </h1>
      <p className="mb-6 max-w-2xl text-sm text-on-surface-variant">
        Anyone whose work address is at one of these domains can sign in without
        an invite. Matching is exact: <code>spc.int</code> does not cover
        <code> mail.spc.int</code>, which needs its own row. Personal mail
        providers are refused, since one row would admit everyone; invite those
        addresses individually instead.
      </p>

      <form onSubmit={add} className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="type-label-md mb-1 block text-on-surface-variant">
            Domain
          </label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="stats.gov.example"
            required
            className="rounded-[var(--radius-md)] bg-surface-high px-3 py-2 text-sm text-on-surface"
          />
        </div>
        <div>
          <label className="type-label-md mb-1 block text-on-surface-variant">
            Organisation
          </label>
          <input
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="National Statistics Office"
            className="w-72 rounded-[var(--radius-md)] bg-surface-high px-3 py-2 text-sm text-on-surface"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          Add domain
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-[var(--radius-md)] bg-error-container px-3 py-2 text-sm text-on-error-container">
          {error}
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead className="text-on-surface-variant">
          <tr>
            <th className="py-2">Domain</th>
            <th className="py-2">Organisation</th>
            <th className="py-2">Note</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.domain} className="border-t border-surface-high/40">
              <td className="py-2 font-medium text-on-surface">{r.domain}</td>
              <td className="py-2 text-on-surface-variant">
                {r.organisation ?? "—"}
              </td>
              <td className="py-2 text-on-surface-variant">{r.note ?? "—"}</td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => remove(r.domain)}
                  className="text-xs text-on-surface-variant underline hover:text-on-surface"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-on-surface-variant">
                No domains yet. Everyone signs in by invite until one is added.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="mt-6 max-w-2xl text-xs text-on-surface-variant">
        Removing a domain does not sign anyone out or delete accounts. It stops
        new people at that organisation from signing up.
      </p>
    </div>
  );
}
