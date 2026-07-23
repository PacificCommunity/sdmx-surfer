"use client";

import { useEffect, useState } from "react";

/**
 * Banner shown when the app is served from a *.vercel.app host — which,
 * now that production lives on sdmxsurfer.net, always means a dev or
 * preview deployment. Keying on the runtime hostname (rather than a
 * branch name or env var) means this needs no changes when dev branches
 * merge to main: production on the custom domain never matches, preview
 * deployments always do.
 *
 * Dismissal is per browser session (sessionStorage), so habitual
 * old-URL visitors get a gentle reminder each visit without being
 * nagged on every navigation.
 */
const DISMISS_KEY = "dev-host-banner-dismissed";

export function DevHostBanner() {
  const [stableUrl, setStableUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!window.location.hostname.endsWith(".vercel.app")) return;
    if (sessionStorage.getItem(DISMISS_KEY)) return;
    // Same path on the stable host, so users land where they were.
    setStableUrl(
      "https://sdmxsurfer.net" +
        window.location.pathname +
        window.location.search,
    );
  }, []);

  if (!stableUrl) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center px-3 pt-3">
      <div className="flex max-w-2xl items-center gap-3 rounded-lg bg-[#c2410c]/85 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-[20px]">
        <p className="leading-snug">
          You are on the <span className="font-semibold">development</span>{" "}
          version of SDMX Surfer. Stay here to try what&apos;s next, or use{" "}
          <a
            href={stableUrl}
            className="font-semibold underline decoration-[#fed7aa] underline-offset-2 hover:text-[#fed7aa]"
          >
            sdmxsurfer.net
          </a>{" "}
          for the stable version.
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, "1");
            setStableUrl(null);
          }}
          className="rounded-md px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
