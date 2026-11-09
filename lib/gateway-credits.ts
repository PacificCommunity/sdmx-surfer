import { z } from "zod";

// Server-side only: reads AI_GATEWAY_API_KEY, which must never reach the client.
//
// The Vercel AI Gateway key is shared by the dev and production deployments,
// so balance and total_used cover both (and anything else using the key) —
// they are account-wide figures, not this deployment's spend.

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

// The gateway returns decimal amounts as strings, e.g.
// {"balance":"36.87718","total_used":"288.12282"}.
const decimal = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const n = Number(value);
  if (value === "" || !Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "not a finite number" });
    return z.NEVER;
  }
  return n;
});

const creditsResponseSchema = z.object({
  balance: decimal,
  total_used: decimal,
});

export interface GatewayCredits {
  balanceUsd: number;
  totalUsedUsd: number;
}

export async function fetchGatewayCredits(): Promise<GatewayCredits | null> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[gateway-credits] HTTP " + res.status);
      return null;
    }
    const parsed = creditsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[gateway-credits] unexpected response shape", parsed.error.issues);
      return null;
    }
    return {
      balanceUsd: parsed.data.balance,
      totalUsedUsd: parsed.data.total_used,
    };
  } catch (error) {
    console.warn("[gateway-credits] request failed", error);
    return null;
  }
}
