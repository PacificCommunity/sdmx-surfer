import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  verifyPassword,
  mintCookieValue,
  verifyCookie,
} from "../../lib/country-snapshots/auth";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-32-chars-long-padding!";
  process.env.COUNTRY_SNAPSHOTS_PASSWORD = "CountrySnapshots";
});

describe("snapshot auth", () => {
  beforeEach(() => {
    // Reset between tests that mutate the env var
    process.env.COUNTRY_SNAPSHOTS_PASSWORD = "CountrySnapshots";
  });

  it("accepts the configured password and rejects others", () => {
    expect(verifyPassword("CountrySnapshots")).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  it("round-trips a signed cookie", () => {
    const { value, uid } = mintCookieValue();
    const payload = verifyCookie(value);
    expect(payload?.uid).toBe(uid);
  });

  it("rejects a tampered cookie", () => {
    const { value } = mintCookieValue();
    const [body, sig] = value.split(".");
    // Mutate the body but keep length equal so structural checks pass
    const tamperedBody = body.replace(/./, (c) => (c === "A" ? "B" : "A"));
    expect(verifyCookie(tamperedBody + "." + sig)).toBeNull();
  });

  it("rejects a cookie with missing or malformed structure", () => {
    expect(verifyCookie(undefined)).toBeNull();
    expect(verifyCookie("")).toBeNull();
    expect(verifyCookie("not-a-cookie")).toBeNull();
    expect(verifyCookie("body.")).toBeNull();
  });

  it("invalidates outstanding cookies when password rotates", () => {
    const { value } = mintCookieValue();
    expect(verifyCookie(value)?.uid).toBeTruthy();
    process.env.COUNTRY_SNAPSHOTS_PASSWORD = "RotatedPassword";
    expect(verifyCookie(value)).toBeNull();
  });

  it("does not throw on multibyte candidate passwords", () => {
    // String .length counts UTF-16 units, not bytes — a raw-buffer
    // timingSafeEqual comparison used to throw RangeError here.
    expect(verifyPassword("Cöuntry™Snapsh😀")).toBe(false);
    expect(verifyPassword("🦀".repeat(8))).toBe(false);
  });

  it("treats missing configuration as unauthenticated, never a throw", () => {
    const { value } = mintCookieValue();
    const savedSecret = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    // verifyCookie runs in the layout gate and on the login page itself,
    // so a config error must read as "not logged in", not a 500.
    expect(verifyCookie(value)).toBeNull();
    process.env.NEXTAUTH_SECRET = savedSecret;
    delete process.env.COUNTRY_SNAPSHOTS_PASSWORD;
    expect(verifyCookie(value)).toBeNull();
    expect(verifyPassword("CountrySnapshots")).toBe(false);
  });
});
