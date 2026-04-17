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
