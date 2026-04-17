// Shared formatters for admin pages.

export function formatUsd(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return "—";
  return cost.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// NextAuth magic links have maxAge 15 min, so requested_at ≈ expires - 15 min.
export function formatRequestedAgo(lastExpiresAt: string | null): string | null {
  if (!lastExpiresAt) return null;
  const expiresMs = new Date(lastExpiresAt).getTime();
  if (Number.isNaN(expiresMs)) return null;
  const requestedMs = expiresMs - 15 * 60 * 1000;
  const deltaMin = Math.max(0, Math.round((Date.now() - requestedMs) / 60000));
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return deltaMin + "m ago";
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return deltaHr + "h ago";
  const deltaDay = Math.round(deltaHr / 24);
  return deltaDay + "d ago";
}
