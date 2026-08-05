import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  enabledOAuthProviders,
  openSignupEnabled,
} from "@/lib/oauth-providers";

const KEYS = [
  "AUTH_GOOGLE_ID",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_GITHUB_ID",
  "AUTH_OPEN_SIGNUP",
];
const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("oauth provider configuration", () => {
  it("offers nothing before any provider is registered", () => {
    // The app has to deploy cleanly with no OAuth apps in existence, so the
    // sign-in page falls back to email alone rather than showing dead buttons.
    expect(enabledOAuthProviders()).toEqual([]);
  });

  it("offers only the providers that are configured", () => {
    process.env.AUTH_GOOGLE_ID = "x";
    expect(enabledOAuthProviders().map((p) => p.id)).toEqual(["google"]);

    process.env.AUTH_GITHUB_ID = "y";
    expect(enabledOAuthProviders().map((p) => p.id)).toEqual([
      "google",
      "github",
    ]);
  });

  it("uses the Auth.js provider ids, which the callback URLs depend on", () => {
    process.env.AUTH_GOOGLE_ID = "x";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "y";
    process.env.AUTH_GITHUB_ID = "z";
    // A mismatch here produces a redirect_uri that the provider rejects, so
    // these ids are pinned: google, microsoft-entra-id, github.
    expect(enabledOAuthProviders()).toEqual([
      { id: "google", name: "Google" },
      { id: "microsoft-entra-id", name: "Microsoft" },
      { id: "github", name: "GitHub" },
    ]);
  });

  it("keeps signup closed unless explicitly opened", () => {
    expect(openSignupEnabled()).toBe(false);
    process.env.AUTH_OPEN_SIGNUP = "false";
    expect(openSignupEnabled()).toBe(false);
    // Adding a provider must not open the service as a side effect.
    process.env.AUTH_GOOGLE_ID = "x";
    expect(openSignupEnabled()).toBe(false);
  });

  it("opens signup only on the exact value", () => {
    process.env.AUTH_OPEN_SIGNUP = "true";
    expect(openSignupEnabled()).toBe(true);
    for (const v of ["TRUE", "1", "yes", ""]) {
      process.env.AUTH_OPEN_SIGNUP = v;
      expect(openSignupEnabled()).toBe(false);
    }
  });
});
