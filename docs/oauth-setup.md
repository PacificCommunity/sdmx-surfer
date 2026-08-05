# OAuth sign-in setup

What to register with Google, Microsoft and GitHub, and how the migration is
staged so nobody is locked out.

## Why it is staged

Every existing account was created by email sign-in, and none has an OAuth link.
Turning OAuth on badly would create a second, empty account for a returning user
and strand their dashboards and any admin role. So two things are true of the
code as it stands:

- **Providers appear only when configured.** A provider with no credentials is
  not registered and its button is not rendered. The app runs unchanged until
  you register something.
- **Signup stays closed until you open it.** `AUTH_OPEN_SIGNUP` defaults to
  off, so adding a provider does not open the service to the public as a side
  effect. Existing invited users can sign in via OAuth immediately; strangers
  cannot until the switch is flipped.

Accounts are linked on verified email, so signing in with Microsoft as
`someone@spc.int` lands on the existing `someone@spc.int` account, keeping its
dashboards and role. This is safe for these three providers because each
verifies the address it returns; it would not be for one that does not.

## Callback URLs

Every provider needs the redirect URI registered exactly. Auth.js derives it
from the provider id, so these strings are not adjustable:

| Provider | Provider id | Redirect URI |
| --- | --- | --- |
| Google | `google` | `https://sdmxsurfer.net/api/auth/callback/google` |
| Microsoft | `microsoft-entra-id` | `https://sdmxsurfer.net/api/auth/callback/microsoft-entra-id` |
| GitHub | `github` | `https://sdmxsurfer.net/api/auth/callback/github` |

Register the development host too, substituting
`https://sdmx-surfer.vercel.app`. Vercel preview deployments get a new hostname
per deploy and cannot be registered ahead of time; sign in on the dev host
instead.

When the service moves to `surfer.pacificdata.org`, add those three URIs as
well. Keep the old ones registered until the redirect is retired.

## Registration

### Google

1. Google Cloud console → **APIs & Services** → **Credentials**.
2. Configure the OAuth consent screen if prompted. External, with the app name
   and a support email.
3. **Create credentials** → **OAuth client ID** → **Web application**.
4. Add the redirect URIs above.
5. Copy the client ID and secret.

### Microsoft

1. Entra admin centre → **App registrations** → **New registration**.
2. Supported account types: **accounts in any organisational directory and
   personal Microsoft accounts**. Anything narrower excludes the partner
   organisations in the user base.
3. Redirect URI: platform **Web**, the URIs above.
4. **Certificates & secrets** → **New client secret**. Note the expiry: Entra
   secrets expire, and an expired one takes sign-in down for everyone using
   that provider. Record the renewal date.
5. Copy the application (client) ID and the secret **value**, not its ID.

### GitHub

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New**.
2. Homepage URL: the production URL. Authorization callback URL: the GitHub URI
   above. A GitHub OAuth app takes **one** callback URL, so register a second
   app for the development host.
3. Copy the client ID, then generate and copy a client secret.

## Environment variables

Auth.js v5 picks these up by name. Set them in Vercel for Production, and the
development set on the dev environment:

```
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
AUTH_MICROSOFT_ENTRA_ID_ID
AUTH_MICROSOFT_ENTRA_ID_SECRET
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
```

`AUTH_MICROSOFT_ENTRA_ID_ISSUER` is only needed to restrict sign-in to a single
tenant, which the governance decision does not ask for.

Watch for trailing whitespace when pasting. A stored `GOOGLE_AI_API_KEY` in this
project carried a trailing newline for months, and the same mistake in a client
secret produces an authentication failure with no useful message.

## Who may sign in

Three rules, any one of which admits a user:

1. `AUTH_OPEN_SIGNUP=true` — anyone with a working provider account.
2. Their email domain is in the `allowed_domains` table.
3. Their exact address is in `allowed_emails`, the invite list.

**Matching is exact.** `spc.int` admits `someone@spc.int` and nothing else;
`mail.spc.int` needs its own row. There is no wildcard or subdomain form, by
decision: a subdomain grant reads smaller than it is, and this table is the only
thing between a stranger and an account. It does not admit `notspc.int`, which
anyone can register, nor `spc.int@gmail.com`.

The rule is worth exactly as much as the address behind it, which is why it is
sound with these three providers and would not be in general: Google, Microsoft
and GitHub each verify the address they return.

**Personal mail providers are refused** by the admin API and the seed script.
One `gmail.com` row would admit everyone while looking like an ordinary entry,
and both `gmail.com` and `outlook.com` already appear among real users, so it is
a live mistake rather than a hypothetical one.

**Keep the invite list.** It is not made redundant. A good number of statistics
staff in the region work from personal addresses, and a domain rule alone would
exclude exactly the people it exists to include.

### Managing the list

Admin panel → **Domains**, or seed the initial set:

```
npx tsx scripts/seed-allowed-domains.mts            # dry run
npx tsx scripts/seed-allowed-domains.mts --write
```

The seed carries two groups: ten domains **observed** in this deployment's own
users and invites, and partner governments and international organisations by
their well-known primary domain, including NZ MFAT, Australian DFAT, the Forum
Secretariat, SPREP, ADB, the World Bank, IMF and the UN agencies.

**It asserts nothing about the member NSOs it cannot confirm.** Twenty-one
PICTs are named in the script as needing one mail domain each, deliberately left
blank rather than guessed. A guessed domain is worse than a missing one: it
either does nothing, or it admits a domain somebody else owns. Confirm each from
the office's own site or from mail you have received, then add it.

Enumerate rather than react. Adding domains as requests arrive produces a list
shaped by whoever asked first, which across the membership reads as favouritism
whatever the intent.

## Rollout

1. **Register one provider and set its variables on the dev environment.** The
   button appears on the dev sign-in page and nowhere else.
2. **Sign in as an existing invited user** and confirm you land on the same
   account: your dashboards are there and an admin is still an admin. This is
   the step that proves account linking works, and it is worth doing before
   production.
3. **Repeat for the other two**, then set all three on production.
4. **Verify an admin can sign in through OAuth** before anything is removed.
   Losing the last admin path is the one unrecoverable failure here.
5. **Open signup** with `AUTH_OPEN_SIGNUP=true` on production. The usage caps
   are the cost control from that point: 20 turns per day per user and a hard
   USD 1,000 cumulative budget.
6. **Only then** retire the email and password providers and the allowlist,
   with Resend, in a separate change.

Steps 1 to 5 are all reversible: unset a variable and the provider disappears;
unset `AUTH_OPEN_SIGNUP` and the door closes again. Step 6 is not, which is why
it is last and separate.
