# Training-day access

Temporary. Hands ~100 workshop participants their own account in a few minutes,
without invites, inboxes or a shared login.

## How it works

`/training` asks for one shared code. `POST /api/training/claim` checks it,
takes a free slot from a pool of 200, and creates
`trainee-NN@training.sdmxsurfer.net` with a generated passphrase. The page shows
the credentials, keeps them in localStorage so a reload does not spend a second
slot, and signs the participant in to `/builder`.

Each participant gets a real account, so sessions stay separate, the per-user
turn cap applies per person, and a mistyped password locks only that one
account. The subdomain receives no mail; these accounts never use magic links.

Both the page and the route answer 404 unless `TRAINING_MODE=1` and
`TRAINING_ACCESS_CODE` is set, so they do not exist on production.

## Switching it on (dev only)

Set on the Vercel project, scoped to Preview and the `dev` branch, then redeploy:

| Variable | Value |
|---|---|
| `TRAINING_MODE` | `1` |
| `TRAINING_ACCESS_CODE` | the code shown on the slide |
| `AI_BUDGET_CAP_USD` | the ceiling you are willing to spend that day |

The budget cap is a hard stop for everyone once cumulative spend passes it, so
pick it deliberately. Per-user limits (`OPEN_TIER_DAILY_TURNS`, default 20) keep
one person from taking the whole budget.

## Switching it off

1. Set `TRAINING_MODE` to `0` and redeploy. The door is now shut.
2. `npx tsx scripts/clear-training-accounts.ts` lists the accounts.
3. `npx tsx scripts/clear-training-accounts.ts --yes` deletes them and their
   dashboards. It only matches the trainee subdomain, so real accounts are safe.
