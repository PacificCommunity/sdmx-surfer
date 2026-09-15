import { LoginView } from "./login-view";
import { enabledOAuthProviders } from "@/lib/oauth-providers";

/**
 * Server shell for the sign-in page.
 *
 * Exists so the provider list is read on the server: which providers are
 * configured depends on environment variables, and the form is a client
 * component. Rendering a button for a provider that has no credentials would
 * fail only once a user clicked it.
 */
export default function LoginPage() {
  return <LoginView providers={enabledOAuthProviders()} />;
}
