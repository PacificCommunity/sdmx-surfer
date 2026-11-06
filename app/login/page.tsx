import { LoginView } from "./login-view";
import { enabledOAuthProviders } from "@/lib/oauth-providers";
import { emailProofConfig } from "@/lib/email-proof";
import { PASSWORD_POLICY } from "@/lib/password";

/**
 * Server shell for the sign-in page.
 *
 * Exists so the provider list is read on the server: which providers are
 * configured depends on environment variables, and the form is a client
 * component. Rendering a button for a provider that has no credentials would
 * fail only once a user clicked it. Self-service accounts are offered on the
 * same terms: only when inbound email proof is configured.
 */
export default function LoginPage() {
  return (
    <LoginView
      providers={enabledOAuthProviders()}
      selfServiceEnabled={emailProofConfig() !== null}
      passwordPolicy={PASSWORD_POLICY}
    />
  );
}
