import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(),
  },
  rateLimitCounters: {
    bucket: "bucket",
    key_hash: "key_hash",
    window_start: "window_start",
    count: "count",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  lt: vi.fn(() => "lt"),
  // Keep the template pieces so tests can see which statement ran and with
  // which parameters.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    values,
  })),
}));

import {
  admits,
  consumeRateLimit,
  hashRateLimitKey,
  retryAfterSeconds,
  slidingWindowAt,
  type RateLimitPolicy,
} from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { lt } from "drizzle-orm";

interface CapturedSql {
  text: string;
  values: unknown[];
}

const MINUTE = 60 * 1000;
const policy: RateLimitPolicy = { bucket: "test", limit: 3, windowMs: 10 * MINUTE };
const proxyPolicy: RateLimitPolicy = {
  bucket: "proxy",
  limit: 120,
  windowMs: 10 * MINUTE,
};

/**
 * Replays request times through the same predicate the SQL applies, with an
 * in-memory counter per window, and returns which requests were served.
 */
function simulate(policyUnderTest: RateLimitPolicy, times: number[]): boolean[] {
  const served = new Map<number, number>();
  return times.map((t) => {
    const w = slidingWindowAt(t, policyUnderTest.windowMs);
    const previous = served.get(w.previousStartMs) ?? 0;
    const current = served.get(w.currentStartMs) ?? 0;
    const ok = admits(previous, current, w.previousWeight, policyUnderTest.limit);
    if (ok) served.set(w.currentStartMs, current + 1);
    return ok;
  });
}

function every(fromMs: number, toMs: number, stepMs: number): number[] {
  const times: number[] = [];
  for (let t = fromMs; t < toMs; t += stepMs) times.push(t);
  return times;
}

function executeReturns(row: Record<string, unknown> | Error) {
  vi.mocked(db.execute).mockImplementation(((query: CapturedSql) => {
    if (query.text.includes("DELETE")) return Promise.resolve({ rows: [] });
    return row instanceof Error
      ? Promise.reject(row)
      : Promise.resolve({ rows: [row] });
  }) as never);
}

function consumeCall(): CapturedSql {
  const call = vi
    .mocked(db.execute)
    .mock.calls.map(([q]) => q as unknown as CapturedSql)
    .find((q) => !q.text.includes("DELETE"));
  if (!call) throw new Error("no consume statement ran");
  return call;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Keep the opportunistic purge out of the way unless a test opts in.
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("slidingWindowAt", () => {
  it("splits time into the current and previous fixed windows", () => {
    expect(slidingWindowAt(1_234_567, 1000)).toEqual({
      currentStartMs: 1_234_000,
      previousStartMs: 1_233_000,
      previousWeight: 1 - 0.567,
    });
    expect(slidingWindowAt(600_000, 600_000).previousWeight).toBe(1);
  });
});

describe("sliding-window decisions", () => {
  const windowN = Date.UTC(2026, 10, 17, 12, 20);
  const windowN1 = windowN + proxyPolicy.windowMs;

  it("denies a burst straddling the window boundary", () => {
    // The whole limit in the last 2 minutes of window N…
    const lateBurst = every(windowN1 - 2 * MINUTE, windowN1, 1000).slice(0, 120);
    expect(simulate(proxyPolicy, lateBurst).every(Boolean)).toBe(true);

    // …then a request every second for the first minute of window N+1. A fixed
    // window would serve 60 more; the weighted estimate only frees up slots as
    // window N slides out, about limit × elapsed fraction of them.
    const earlyBurst = every(windowN1, windowN1 + MINUTE, 1000);
    const verdicts = simulate(proxyPolicy, [...lateBurst, ...earlyBurst]).slice(
      lateBurst.length,
    );
    expect(verdicts.slice(0, 5)).toEqual([false, false, false, false, false]);
    expect(verdicts.filter(Boolean).length).toBeLessThanOrEqual(12);
  });

  it("serves steady traffic under the limit across many windows", () => {
    // 100 per 10 minutes against a limit of 120.
    const steady = every(windowN, windowN + 30 * MINUTE, 6000);
    expect(simulate(proxyPolicy, steady).every(Boolean)).toBe(true);
  });

  it("holds a client that never stops to the limit without locking it out", () => {
    const hammering = every(windowN, windowN + 40 * MINUTE, 250);
    const verdicts = simulate(proxyPolicy, hammering);
    for (let w = 0; w < 4; w++) {
      const startMs = windowN + w * proxyPolicy.windowMs;
      const servedInWindow = hammering.filter(
        (t, i) =>
          verdicts[i] && t >= startMs && t < startMs + proxyPolicy.windowMs,
      ).length;
      expect(servedInWindow).toBeGreaterThan(100);
      expect(servedInWindow).toBeLessThanOrEqual(proxyPolicy.limit);
    }
    // Any window-length span, not just aligned ones, stays near the limit.
    const servedTimes = hammering.filter((_, i) => verdicts[i]);
    for (const from of every(windowN, windowN + 30 * MINUTE, 37_000)) {
      const inSpan = servedTimes.filter(
        (t) => t >= from && t < from + proxyPolicy.windowMs,
      ).length;
      expect(inSpan).toBeLessThanOrEqual(proxyPolicy.limit + 2);
    }
  });
});

describe("retryAfterSeconds", () => {
  const start = Date.UTC(2026, 10, 17, 12, 30);

  it("waits until enough of the previous window has slid out", () => {
    // 120 last window, none yet: one slot opens at 1/120 of the window (5 s).
    expect(retryAfterSeconds(120, 0, proxyPolicy, start + 1000)).toBe(4);
  });

  it("waits into the next window when the current one is full by itself", () => {
    // Full at 00:30.5 into the window: the window ends in 569.5 s, then 1/120
    // of the next (5 s) must pass before the old count's weight allows one.
    expect(retryAfterSeconds(0, 120, proxyPolicy, start + 30_500)).toBe(575);
  });

  it("never asks the client to wait less than a second", () => {
    // A stale count can put the computed time in the past.
    expect(retryAfterSeconds(3, 0, policy, start + 5 * MINUTE)).toBe(1);
  });

  it("names the first whole second at which the request is admitted", () => {
    // Each pair below is denied at this instant; mid-second to exercise rounding.
    const now = start + 1500;
    const nowWindow = slidingWindowAt(now, proxyPolicy.windowMs).currentStartMs;
    // Counts as they'd stand at `at` if nothing else is served meanwhile.
    const admittedAt = (previous: number, current: number, at: number) => {
      const w = slidingWindowAt(at, proxyPolicy.windowMs);
      const [p, c] =
        w.currentStartMs === nowWindow ? [previous, current] : [current, 0];
      return admits(p, c, w.previousWeight, proxyPolicy.limit);
    };
    for (const [previous, current] of [
      [120, 0],
      [120, 30],
      [60, 90],
      [0, 120],
    ]) {
      const after = retryAfterSeconds(previous, current, proxyPolicy, now);
      expect(admittedAt(previous, current, now + after * 1000)).toBe(true);
      expect(admittedAt(previous, current, now + (after - 1) * 1000)).toBe(
        false,
      );
    }
  });
});

describe("hashRateLimitKey", () => {
  it("is keyed: stable for one secret, different under another", () => {
    const a = hashRateLimitKey("203.0.113.5", "secret-a");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRateLimitKey("203.0.113.5", "secret-a")).toBe(a);
    expect(hashRateLimitKey("203.0.113.5", "secret-b")).not.toBe(a);
    expect(a).not.toBe(
      createHash("sha256").update("203.0.113.5").digest("hex"),
    );
  });

  it("uses AUTH_SECRET, then NEXTAUTH_SECRET, from the environment", () => {
    vi.stubEnv("AUTH_SECRET", "auth-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "legacy-secret");
    expect(hashRateLimitKey("203.0.113.5")).toBe(
      hashRateLimitKey("203.0.113.5", "auth-secret"),
    );
    vi.stubEnv("AUTH_SECRET", undefined);
    expect(hashRateLimitKey("203.0.113.5")).toBe(
      hashRateLimitKey("203.0.113.5", "legacy-secret"),
    );
  });

  it("falls back to plain sha256 without a secret", () => {
    vi.stubEnv("AUTH_SECRET", undefined);
    vi.stubEnv("NEXTAUTH_SECRET", undefined);
    expect(hashRateLimitKey("203.0.113.5")).toBe(
      createHash("sha256").update("203.0.113.5").digest("hex"),
    );
  });
});

describe("consumeRateLimit", () => {
  const now = new Date(Date.UTC(2026, 10, 17, 12, 34, 56));

  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
  });

  it("checks the current and previous windows under a keyed hash, never the raw key", async () => {
    executeReturns({ served: 1, previous: 0, current: 0 });

    await expect(consumeRateLimit(policy, "203.0.113.5", now)).resolves.toEqual(
      { allowed: true },
    );

    expect(db.execute).toHaveBeenCalledTimes(1);
    const { values } = consumeCall();
    expect(values).toContain("test");
    expect(values).toContain(hashRateLimitKey("203.0.113.5", "test-secret"));
    expect(values).toContain("2026-11-17T12:30:00.000Z");
    expect(values).toContain("2026-11-17T12:20:00.000Z");
    expect(values).toContain(3);
    expect(values).toContain(1 - (4 * MINUTE + 56_000) / policy.windowMs);
    expect(JSON.stringify(values)).not.toContain("203.0.113.5");
  });

  it("denies when the statement serves nothing, with Retry-After from the counts", async () => {
    // Driver returns integers as numbers, but don't depend on it.
    executeReturns({ served: null, previous: "0", current: "3" });

    await expect(consumeRateLimit(policy, "203.0.113.5", now)).resolves.toEqual(
      { allowed: false, retryAfterSeconds: retryAfterSeconds(0, 3, policy, now.getTime()) },
    );
  });

  it("fails open when the database errors", async () => {
    executeReturns(new Error("connection refused"));

    await expect(consumeRateLimit(policy, "203.0.113.5", now)).resolves.toEqual(
      { allowed: true },
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("purges only occasionally, keeps the previous window, and a purge failure doesn't change the verdict", async () => {
    vi.mocked(db.execute).mockImplementation(((query: CapturedSql) =>
      query.text.includes("DELETE")
        ? Promise.reject(new Error("purge failed"))
        : Promise.resolve({
            rows: [{ served: null, previous: 0, current: 3 }],
          })) as never);

    await consumeRateLimit(policy, "203.0.113.5", now);
    expect(db.execute).toHaveBeenCalledTimes(1);

    vi.spyOn(Math, "random").mockReturnValue(0);
    await expect(consumeRateLimit(policy, "203.0.113.5", now)).resolves.toEqual(
      { allowed: false, retryAfterSeconds: retryAfterSeconds(0, 3, policy, now.getTime()) },
    );
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(lt).toHaveBeenCalledWith(
      "window_start",
      new Date(Date.UTC(2026, 10, 17, 12, 20)),
    );
  });
});
