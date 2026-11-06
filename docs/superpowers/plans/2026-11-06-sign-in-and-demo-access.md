# Sign-in for SPC / MFAT staff, and access for the demo

Status: **parked on 2026-11-06**. Sections 1–2 record the current state, section 3 lists what remains, and section 4 compares ways to run next week's demo.

## 1. Where we are

### Live on production (sdmxsurfer.net) since 2026-11-06
- Dev was promoted to `main`. The production DB was backed up first (`~/sdmx-backups/prod-20261105T211655Z.dump`), then:
  - migration 0007 (`allowed_domains`) was applied;
  - the stored Highcharts `extraOptions` were converted (3 of 188 sessions changed).
- `allowed_domains` has 28 rows on dev and on prod, including `spc.int`, `mfat.govt.nz` and `.govt.nz`. A leading dot is a suffix rule: it admits every `*.govt.nz` address, but not `govt.nz` itself.
- Country Snapshots use the normal Surfer sign-in. The shared password and its env var are gone.
- Signed-out visitors keep their target page through `/login?callbackUrl=…`.

### Why domain sign-up still does not reach SPC staff
- Magic links are accepted by SPC's Exchange Online gateway: Resend shows them as "delivered". After that they vanish. They are not in Inbox, Junk or the Defender quarantine.
- Inside SPC, `mail.spc.int` resolves to an on-prem Exchange host (`NOUEXCH02.corp.spc.int`). The likely cause is a hybrid hand-off to on-prem filtering or a transport rule [INFERENCE]. Only a message trace by SPC IT can confirm it, and IT is unavailable for several days.
- `sdmxsurfer.net` was registered on 2026-06-11. A young sending domain is a negative reputation signal.
- Sign in with Microsoft is blocked. App registration fails both in SPC's directory and in a personal one (401 / no access).
- MFAT's mail goes straight to Exchange Online (`mfat-govt-nz.mail.protection.outlook.com`). It has not been tested.

### Built on dev, switched off: password sign-up proven by an email the user sends us
Commit 2ce832f. Full design: `docs/email-proof-signup.md`.
- On `/login`, "Create an account" and "Forgot password?" ask for a work email and a password. The page then asks the user to send one email to `verify-<code>@in.sdmxsurfer.net`.
- Resend Receiving posts that email to `/api/auth/inbound-email`. The proof is accepted only when DMARC is `pass` and the header From is exactly the address entered. After that the user signs in with email and password.
- No mail is ever sent into the user's inbox.
- Partner DMARC policies make this a real proof: spc.int is `p=quarantine`, mfat.govt.nz is `p=reject`, stats.govt.nz is `p=reject`.
- Migration 0008 (`email_proofs`) is applied on the dev DB only.
- Verified locally:
  - form → proof card;
  - signed webhook accepted, bad signature answered with 401;
  - a verified proof signs the user in and lands on the callbackUrl;
  - password sign-in afterwards.
- Not yet exercised: the real Resend fetch, and DMARC on real SPC/MFAT mail.
- The feature is hidden until all three env vars below are set.

## 2. Credentials and settings in play
| Where | Name | State |
|---|---|---|
| Vercel prod + dev | `RESEND_API_KEY` | send-only key; fine for magic links |
| Vercel dev (then prod) | `INBOUND_EMAIL_DOMAIN` | to set: `in.sdmxsurfer.net` |
| Vercel dev (then prod) | `RESEND_WEBHOOK_SECRET` | to set: one `whsec_…` per deployment's webhook |
| Vercel dev (then prod) | `RESEND_RECEIVING_API_KEY` | to set: a full-access Resend key (reads received mail) |
| Hover DNS | MX for `in.sdmxsurfer.net` | to add, value from Resend |

## 3. To finish the email-proof sign-up
1. **Owner** (no IT needed):
   - In Resend, add `in.sdmxsurfer.net` with Receiving enabled.
   - At Hover, add the MX record Resend shows.
   - Create a webhook to `https://sdmx-surfer.vercel.app/api/auth/inbound-email` for `email.received`.
   - Create a full-access API key.
2. Set the three env vars on Vercel Preview (`dev` branch) and redeploy.
3. Real test: create an account with an `@spc.int` address, then with an MFAT address. Note the rejection reason if one appears. `dmarc_not_pass` would mean the organisation's outbound path breaks DMARC, and the flow will not work for that organisation.
4. Production:
   - back up the prod DB;
   - `drizzle-kit migrate` (0008) against prod;
   - add a second Resend webhook for `https://sdmxsurfer.net/api/auth/inbound-email`;
   - set the three env vars on production;
   - fast-forward `main`.
5. Later, when SPC IT is back:
   - message trace for `surfer@sdmxsurfer.net`;
   - allow-list `sdmxsurfer.net` in the Tenant Allow/Block List;
   - optionally register "Sign in with Microsoft" in SPC's tenant.

## 4. Options for the demo next week

| Option | Ready | Who acts | Proof of identity | Risks |
|---|---|---|---|---|
| A. Training-day codes (the Korea workshop setup) | yes, on dev; prod needs env vars | owner sets 3 env vars | none: whoever has the code | shared code for the session; accounts are `trainee-NN@training.sdmxsurfer.net`, not named |
| B. Admin-provisioned passphrases | yes, prod | owner, ~1 min per person in `/admin` | owner knows each person | owner in the loop; passphrases sent via Teams/WhatsApp, not email |
| C. Email-proof sign-up (section 1) | needs section 3, steps 1–3 | owner, ~10 min setup + a test | DMARC-verified address | unknown until tested whether SPC's on-prem relay keeps DMARC passing |
| D. Present-only + public links | yes, prod | nobody | n/a | audience can't build; snapshots need sign-in, so publish snapshot views as dashboards (`/p/…`) |

**A. Training-day mode** (`docs/training-day.md`):
- `/training` asks for one code, then creates a per-person account from a pool of 200 (`MAX_TRAINEES`). It shows a generated passphrase and signs the person straight into `/builder`.
- Each person gets their own sessions and turn cap, and can also open Country Snapshots, since that now uses the normal sign-in.
- Switch it on by setting `TRAINING_MODE=1`, `TRAINING_ACCESS_CODE=<code>` and a deliberate `AI_BUDGET_CAP_USD`, then redeploy.
- Switch it off by setting `TRAINING_MODE=0`, then `npx tsx scripts/training-accounts.ts --park` (keeps dashboards) or `--delete`.
- The dev DB still holds trainee accounts from earlier workshops. Run the report first, and `--park`/`--delete` them if the pool needs room.
- To run it on production, set the same env vars on the Production environment for the demo week, then unset them.

**Recommendation**:
- **Run C now.** Do the 10-minute setup and the SPC/MFAT test this week. If it passes, the demo uses real, self-service accounts that stay valid afterwards.
- **Fallback A:** keep training-day codes ready for the session itself. They are guaranteed to work whatever happens with Outlook or DMARC.
- **Add B** for the two or three MFAT people who should keep access after the demo, if C fails.
