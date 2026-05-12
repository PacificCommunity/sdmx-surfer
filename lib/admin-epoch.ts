// Shared cutoff for admin usage analytics.
//
// Earlier rows in usage_logs have no cost_usd populated (they predate cost
// tracking), so aggregating them into spending dashboards would skew the
// picture — huge Claude history would effectively show as "free". Admin API
// routes filter usage_logs to rows at or after this timestamp. The raw
// usage_logs table is untouched; point SQL at the table directly for
// full-history audits.
//
// Bump this when you want a fresh window (e.g. after a major prompt fix).
export const USAGE_EPOCH = new Date("2026-04-16T00:00:00Z");

// Cutoff for cost and token aggregations specifically.
//
// Before 2026-05-12, `cost_usd` and the token columns recorded only the FINAL
// step of each multi-step turn (AI SDK v6 `onFinish` extends the final step's
// `StepResult`, not the aggregate). SDMX Surfer turns are 8-20 steps each, so
// pre-cutoff cost figures are systematically undercounted (roughly 25% of the
// gateway-reported total). After the chat-route fix landed, every step's
// cost is summed from `steps[]` and tokens come from `totalUsage` — accurate
// from here on.
//
// USAGE_EPOCH stays where it is (so dataflow / endpoint / session stats still
// cover the full window); only the spend / token sums are gated on this
// stricter cutoff. Bump when shipping another cost-accounting fix; otherwise
// leave alone.
export const COST_TRUSTED_FROM = new Date("2026-05-12T00:00:00Z");
