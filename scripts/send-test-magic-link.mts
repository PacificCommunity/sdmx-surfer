/**
 * Send the real sign-in email to a test inbox, to see how a mail filter
 * treats it (Outlook.com, mail-tester.com, an SPC or MFAT mailbox).
 *
 * The body is byte-for-byte what users receive (lib/magic-link-email.ts). The
 * link carries a random ref that matches no stored sign-in, so it opens the
 * "link expired" page and grants nothing.
 *
 * Usage:
 *   npx tsx scripts/send-test-magic-link.mts --to someone@outlook.com [--to …]
 *     [--from "SDMX Surfer <surfer@sdmxsurfer.net>"] [--base https://sdmxsurfer.net]
 *
 * Needs RESEND_API_KEY (and EMAIL_FROM unless --from) in the shell or .env.local.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { Resend } from "resend";
import { buildMagicLinkBody, MAGIC_LINK_SUBJECT } from "../lib/magic-link-email";

const { values } = parseArgs({
  options: {
    to: { type: "string", multiple: true },
    from: { type: "string" },
    base: { type: "string", default: "https://sdmxsurfer.net" },
  },
});

const key = process.env.RESEND_API_KEY?.trim();
const from = values.from ?? process.env.EMAIL_FROM;
if (!values.to?.length || !key || !from) {
  console.error("Need --to, RESEND_API_KEY and EMAIL_FROM (or --from).");
  process.exit(1);
}

const resend = new Resend(key);
for (const to of values.to) {
  const verifyUrl = values.base + "/login/verify?ref=" + randomBytes(16).toString("hex");
  const { html, text } = buildMagicLinkBody(verifyUrl);
  const { data, error } = await resend.emails.send({ from, to, subject: MAGIC_LINK_SUBJECT, html, text });
  console.log(to + ": " + (error ? "FAILED " + error.message : "sent, Resend id " + String(data?.id)));
}
