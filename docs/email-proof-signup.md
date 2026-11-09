# Self-service accounts by email proof

How users create a password account, or reset its password, without us sending
anything to their mailbox. Linked from `oauth-setup.md`; the code is
`lib/email-proof.ts`, `app/api/auth/email-proof/*`, `app/api/auth/inbound-email`
and the `email-proof` provider in `lib/auth.ts`.

## Why

SPC's Outlook/Exchange silently swallows our outbound magic-link emails, and
Microsoft sign-in needs SPC IT to act. So the direction is reversed: instead of
us mailing the user, **the user mails us once**, from their work account, and we
check how that message authenticated.

## The flow

1. On `/login` the user picks **Create an account** or **Forgot password?**,
   enters their work email and a password (12–128 characters) twice.
2. `POST /api/auth/email-proof/start` checks the address is admitted (break-glass
   admin, an `allowed_domains` rule or the invite list, the same
   `isEmailAdmitted` every sign-in path uses), hashes the password with
   argon2id, and stores an `email_proofs` row with a random 10-character code,
   valid 15 minutes. The browser gets an httpOnly cookie holding the proof id
   and a secret; only the secret's sha256 is stored.
3. The page shows `verify-<code>@INBOUND_EMAIL_DOMAIN` with a `mailto:` button
   (subject and body prefilled, though neither is checked) and polls
   `GET /api/auth/email-proof/status` every 3 seconds. Status answers only to
   the browser holding the cookie.
4. Resend Receiving accepts the message and calls
   `POST /api/auth/inbound-email`. The webhook verifies Resend's signature,
   fetches the received email from the Resend API, and marks the proof
   **verified** only if DMARC passed and the header From is exactly the address
   being proved. Anything else records a rejection the page explains.
5. On verified the page calls `signIn("email-proof", { proofId })`. The provider
   checks the cookie secret, that the proof was verified within the last 15
   minutes and never used, and admission again; then claims the proof with a
   conditional update (one use only) and creates the account or sets the new
   password on the existing one (clearing any lockout, keeping its role).

Signup and reset are the same operation. The start step never looks at whether
an account exists, so a reset reveals nothing about who has one.

After that the user signs in with email + password on the ordinary form.

## Why DMARC pass + exact From is the proof

DMARC pass means the From domain's own mail system vouched for the message:
SPF or DKIM passed **and** aligned with the From domain. Our partner domains
publish strict policies (`spc.int` p=quarantine, `mfat.govt.nz` and
`stats.govt.nz` p=reject), so a forged From from outside fails. The exact From
match then ties the proof to one mailbox, so a colleague on the same domain
cannot prove someone else's address; sending as another mailbox inside an
organisation ordinarily needs delegated send-as rights.

What it does not prove: that the domain's mail system is itself honest. A domain
with no DMARC record, or one whose result is `gray`/`unknown`, is rejected with
"your organisation's mail system didn't authenticate this message; ask the
Surfer admin". Those users need an invite plus a provider, or an
admin-set password.

## Setup

### Resend Receiving and DNS (Hover)

1. In Resend, add the receiving domain, e.g. `in.sdmxsurfer.net`, and enable
   receiving on it.
2. In Hover's DNS for `sdmxsurfer.net`, add the MX record Resend shows for the
   `in` subdomain (host `in`, priority as given). A dedicated subdomain keeps
   receiving separate from any mail on the apex.
3. In Resend → Webhooks, create a webhook for the `email.received` event pointing
   at `https://<host>/api/auth/inbound-email`, one per deployment:
   - `https://sdmxsurfer.net/api/auth/inbound-email`
   - `https://sdmx-surfer.vercel.app/api/auth/inbound-email` (dev)
   Copy each webhook's signing secret.

Dev and prod may both receive every message for the shared inbound domain. Each
deployment ignores codes it never issued, so that is harmless.

### Environment variables

```
INBOUND_EMAIL_DOMAIN=in.sdmxsurfer.net
RESEND_WEBHOOK_SECRET=whsec_...       # the webhook's signing secret, per deployment
RESEND_RECEIVING_API_KEY=re_...       # optional; falls back to RESEND_API_KEY
```

The feature is off, and its links hidden from `/login`, unless the domain, the
webhook secret and an API key able to read received emails are all set. The
start endpoint answers 503 while it is off.

Apply migration `drizzle/0008_*.sql` (the `email_proofs` table) before setting
the variables.

## Limits and audit

- At most 5 proofs per address and 5 per IP address per hour.
- `auth_events` records `email_proof_started`, `email_proof_verified`,
  `email_proof_rejected` (with the reason, From and authentication results),
  `email_proof_completed` and `email_proof_failure`.

## Signup without proof (`UNVERIFIED_SIGNUP_DOMAINS`)

For partners whose mail cannot do the proof (Microsoft 365 mailboxes that never
see our links, Microsoft sign-in waiting on IT), the owner accepts **not
verifying the address** for named domains. Set
`UNVERIFIED_SIGNUP_DOMAINS=mfat.govt.nz` (comma-separated, `allowed_domains`
syntax: exact `mfat.govt.nz` or suffix `.govt.nz`; invalid or personal-provider
entries are dropped with a warning). Empty or unset means off.

- On `/login`, **New here? Create an account** then shows even without email
  proof. A work email at a listed domain plus a password (twice) calls
  `POST /api/auth/signup` and signs straight in with that password. Other
  addresses fall into the email-proof flow when it is configured, or are told
  self-service is limited to the listed domains.
- The address is NOT verified: anyone can register any address at a listed
  domain, first come first served. If someone squats a colleague's address, an
  admin deletes that account and the real owner signs up again.
- It only ever creates accounts. An existing account answers 409 and is never
  changed (no password set or reset), so it cannot take one over. Forgotten
  passwords go to the Surfer admin, as the password form says.
- `isEmailAdmitted` still governs: the address must also pass the
  `allowed_domains` / invite / break-glass rules.
- At most 5 signups per IP and 20 overall per hour, counted from the
  `auth_events` rows of type `unverified_signup` (metadata: the domain).
  Such users have a password and a null `emailVerified`.
