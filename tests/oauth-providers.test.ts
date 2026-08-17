import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { enabledOAuthProviders } from "@/lib/oauth-providers";
import { signupIsOpenFor } from "@/lib/signup-policy";

const KEYS = [
  "AUTH_GOOGLE_ID",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_GITHUB_ID",
  "AUTH_OPEN_SIGNUP_PROVIDERS",
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

  it("matches the ids Auth.js itself registers", async () => {
    // The open-signup list is keyed on account.provider, which Auth.js sets
    // from these. A rename upstream (azure-ad became microsoft-entra-id once
    // already) would silently stop matching, and the failure is invisible:
    // sign-in keeps working for everyone on a list, and only new public users
    // are turned away.
    const [google, microsoft, github] = await Promise.all([
      import("next-auth/providers/google"),
      import("next-auth/providers/microsoft-entra-id"),
      import("next-auth/providers/github"),
    ]);
    expect(google.default({}).id).toBe("google");
    expect(microsoft.default({}).id).toBe("microsoft-entra-id");
    expect(github.default({}).id).toBe("github");
  });

  it("can open every provider it offers", () => {
    // Anything offered on the sign-in page must be nameable in
    // AUTH_OPEN_SIGNUP_PROVIDERS, or it could never be opened at all.
    process.env.AUTH_GOOGLE_ID = "x";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "y";
    process.env.AUTH_GITHUB_ID = "z";
    const offered = enabledOAuthProviders().map((p) => p.id);
    process.env.AUTH_OPEN_SIGNUP_PROVIDERS = offered.join(",");
    for (const id of offered) expect(signupIsOpenFor(id)).toBe(true);
  });

  it("keeps signup closed unless explicitly opened", () => {
    expect(signupIsOpenFor("google")).toBe(false);
    // Configuring a provider must not open the service as a side effect.
    process.env.AUTH_GOOGLE_ID = "x";
    expect(signupIsOpenFor("google")).toBe(false);
  });
});
