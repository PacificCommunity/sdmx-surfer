import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

const rowsMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => rowsMock(),
      }),
    }),
  },
  userApiKeys: {},
}));

import { GET } from "@/app/api/settings/keys/route";
import { encryptApiKey } from "@/lib/encryption";

const SECRET = "settings-keys-test-secret-16-chars";

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_SECRET", SECRET);
  authMock.mockResolvedValue({ user: { userId: "user-1" } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/settings/keys", () => {
  it("marks a key that no longer decrypts as unreadable, without returning key material", async () => {
    const readable = encryptApiKey("sk-readable", "openai");
    vi.stubEnv("ENCRYPTION_SECRET", "a-different-secret-16-chars-long");
    const stale = encryptApiKey("sk-stale", "anthropic");
    vi.stubEnv("ENCRYPTION_SECRET", SECRET);
    rowsMock.mockResolvedValue([
      { provider: "openai", encryptedKey: readable, modelPreference: null, updatedAt: null },
      { provider: "anthropic", encryptedKey: stale, modelPreference: null, updatedAt: null },
    ]);

    const res = await GET();
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(body.keys).toEqual([
      { provider: "openai", modelPreference: null, updatedAt: null, unreadable: false },
      { provider: "anthropic", modelPreference: null, updatedAt: null, unreadable: true },
    ]);
    expect(JSON.stringify(body)).not.toContain(stale);
  });

  it("reads keys written under ENCRYPTION_SECRET_PREVIOUS during a rotation", async () => {
    const old = encryptApiKey("sk-old", "google");
    vi.stubEnv("ENCRYPTION_SECRET", "the-new-secret-at-least-16-chars");
    vi.stubEnv("ENCRYPTION_SECRET_PREVIOUS", SECRET);
    rowsMock.mockResolvedValue([
      { provider: "google", encryptedKey: old, modelPreference: null, updatedAt: null },
    ]);

    const body = (await (await GET()).json()) as { keys: Array<{ unreadable: boolean }> };

    expect(body.keys[0].unreadable).toBe(false);
  });

  it("rejects unauthenticated requests", async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });
});
