/**
 * Which OAuth providers are configured, and whether signup is open.
 *
 * Deliberately free of any other import: the sign-in page reads this to decide
 * which buttons to render, and pulling `lib/auth` into that path would drag the
 * database adapter and argon2 along with it.
 *
 * A provider appears only when its credentials are present, so the app deploys
 * and runs before any provider app exists, and one can be added or withdrawn by
 * changing environment variables rather than code. The sign-in page then offers
 * only what will actually work, instead of a button that fails on click.
 */

export interface OAuthProviderInfo {
  /** Auth.js provider id, used in the signIn() call and the callback URL. */
  id: string;
  /** What a user sees on the button. */
  name: string;
}

export function enabledOAuthProviders(): OAuthProviderInfo[] {
  return [
    process.env.AUTH_GOOGLE_ID ? { id: "google", name: "Google" } : null,
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID
      ? { id: "microsoft-entra-id", name: "Microsoft" }
      : null,
    process.env.AUTH_GITHUB_ID ? { id: "github", name: "GitHub" } : null,
  ].filter((p): p is OAuthProviderInfo => p !== null);
}
