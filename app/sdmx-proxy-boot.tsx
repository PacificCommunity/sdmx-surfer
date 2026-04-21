"use client";

import { useEffect } from "react";
import { KEYED_HOST_NAMES } from "@/lib/keyed-hosts";

// Client-side fetch wrapper: rewrites fetches to keyed SDMX hosts so they go
// through /api/sdmx-proxy, where the subscription key is injected server-side.
// Mounted once in app/layout.tsx so the builder, /p/[id], gallery, and any
// future routes all get the wrapper.
//
// Survives version bumps in sdmx-dashboard-components and sdmx-json-parser
// without patch-package maintenance. The "global mutation" concern is modest
// here because the dashboard pages aren't sharing window.fetch with third-
// party scripts that would conflict.

export function SdmxProxyBoot() {
  useEffect(() => {
    const w = window as unknown as { __sdmxProxyInstalled?: boolean };
    if (w.__sdmxProxyInstalled) return;

    const original = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      let urlStr: string | null = null;
      let carriedInit: RequestInit | undefined = init;

      if (typeof input === "string") {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (input && typeof input === "object" && "url" in input) {
        // Request object: forward its properties so the rewrite doesn't drop
        // method/headers/signal that live on the Request (not in `init`).
        const req = input as Request;
        urlStr = req.url;
        carriedInit = {
          method: req.method,
          headers: req.headers,
          signal: req.signal,
          credentials: req.credentials,
          ...carriedInit,
        };
      }

      if (urlStr) {
        try {
          const host = new URL(urlStr, window.location.origin).host;
          if (KEYED_HOST_NAMES.has(host)) {
            return original(
              "/api/sdmx-proxy?url=" + encodeURIComponent(urlStr),
              carriedInit,
            );
          }
        } catch {
          // not a parseable URL, fall through to passthrough
        }
      }

      return original(input, init);
    };

    w.__sdmxProxyInstalled = true;
  }, []);

  return null;
}
