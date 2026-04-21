import { beforeEach, describe, expect, it, vi } from "vitest";

let mockCount = 0;

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: mockCount }]),
      })),
    })),
  },
  authEvents: {
    id: "id",
    event_type: "event_type",
    email: "email",
    created_at: "created_at",
  },
}));

import { checkCsrf } from "@/lib/csrf";
import { deriveJoinedAt, hasSignedUp } from "@/lib/admin-query";
import { isCredentialAttemptThrottled } from "@/lib/auth-throttle";

describe("security helpers", () => {
  beforeEach(() => {
    mockCount = 0;
    process.env.NEXTAUTH_URL = "https://surfer.example.com";
  });

  describe("checkCsrf", () => {
    it("allows missing origin by default", () => {
      const req = new Request("https://surfer.example.com/api/test", {
        method: "POST",
      });
      expect(checkCsrf(req)).toBeNull();
    });

    it("rejects missing origin in strict mode", async () => {
      const req = new Request("https://surfer.example.com/api/test", {
        method: "POST",
      });
      const res = checkCsrf(req, { strict: true });
      expect(res?.status).toBe(403);
      await expect(res?.json()).resolves.toEqual({
        error: "CSRF check failed: missing origin",
      });
    });

    it("accepts matching origin in strict mode", () => {
      const req = new Request("https://surfer.example.com/api/test", {
        method: "POST",
        headers: { origin: "https://surfer.example.com" },
      });
      expect(checkCsrf(req, { strict: true })).toBeNull();
    });
  });

  describe("deriveJoinedAt", () => {
    it("prefers email verification over other signals", () => {
      expect(
        deriveJoinedAt({
          emailVerified: "2026-04-01T00:00:00Z",
          firstLoginAt: "2026-04-02T00:00:00Z",
          firstActiveAt: "2026-04-03T00:00:00Z",
          lastActiveAt: "2026-04-04T00:00:00Z",
          createdAt: "2026-03-01T00:00:00Z",
        }),
      ).toBe("2026-04-01T00:00:00Z");
    });

    it("falls back to createdAt only when later activity exists", () => {
      expect(
        deriveJoinedAt({
          createdAt: "2026-03-01T00:00:00Z",
          lastActiveAt: "2026-04-04T00:00:00Z",
        }),
      ).toBe("2026-03-01T00:00:00Z");
      expect(
        deriveJoinedAt({
          createdAt: "2026-03-01T00:00:00Z",
        }),
      ).toBeNull();
    });

    it("shares the same truthiness rule through hasSignedUp", () => {
      expect(
        hasSignedUp({
          firstLoginAt: "2026-04-02T00:00:00Z",
        }),
      ).toBe(true);
      expect(
        hasSignedUp({
          createdAt: "2026-03-01T00:00:00Z",
        }),
      ).toBe(false);
    });
  });

  describe("isCredentialAttemptThrottled", () => {
    it("returns false below the threshold", async () => {
      mockCount = 9;
      await expect(isCredentialAttemptThrottled("user@example.com")).resolves.toBe(false);
    });

    it("returns true at the threshold", async () => {
      mockCount = 10;
      await expect(isCredentialAttemptThrottled("user@example.com")).resolves.toBe(true);
    });
  });
});
