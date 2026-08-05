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

/**
 * Whether anyone with a working provider account may sign in.
 *
 * Off by default, so adding a provider does not silently open the service. The
 * governance decision is to accept any authenticated Google, Microsoft or
 * GitHub identity, with the usage caps rather than an invite list as the cost
 * control. Keeping it an environment switch means opening the door, and closing
 * it again if that goes badly, needs neither a code change nor a deploy.
 */
export function openSignupEnabled(): boolean {
  return process.env.AUTH_OPEN_SIGNUP === "true";
}
