// The sign-in email, shared by lib/auth.ts and scripts/send-test-magic-link.mts
// so deliverability tests send exactly what users receive.

export const MAGIC_LINK_SUBJECT = "Get ready to surf SDMx data";

export function buildMagicLinkBody(verifyUrl: string): { html: string; text: string } {
  const html =
    "<p>Hi,</p>" +
    "<p>You requested access to <strong>Data Surfer</strong>, " +
    "an early-alpha tool built at the Pacific Community (SPC) for exploring " +
    "SDMx data through conversation.</p>" +
    '<p><a href="' + verifyUrl + '">Click here to sign in</a></p>' +
    "<p>This link expires in 15 minutes and can only be used once. " +
    "If you did not request this, you can safely ignore this email.</p>" +
    "<p>Happy surfing,<br>Giulio Valentino Dalla Riva<br>Pacific Community (SPC)</p>";

  const text =
    "Hi,\n\n" +
    "You requested access to Data Surfer, an early-alpha tool built at the " +
    "Pacific Community (SPC) for exploring SDMx data through conversation.\n\n" +
    "Sign in: " + verifyUrl + "\n\n" +
    "This link expires in 15 minutes and can only be used once. " +
    "If you did not request this, you can safely ignore this email.\n\n" +
    "Happy surfing,\n" +
    "Giulio Valentino Dalla Riva\n" +
    "Pacific Community (SPC)\n";

  return { html, text };
}
