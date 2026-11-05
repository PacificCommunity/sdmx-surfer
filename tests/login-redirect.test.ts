import { describe, it, expect } from "vitest";
import { loginPathWithCallback } from "@/lib/login-redirect";

describe("loginPathWithCallback", () => {
  it("round-trips a same-origin path with its query string", () => {
    const path = loginPathWithCallback(
      "/countrysnapshots/regional/health?scope=mfat",
    );
    const url = new URL(path, "https://surfer.example");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("callbackUrl")).toBe(
      "/countrysnapshots/regional/health?scope=mfat",
    );
  });

  it("encodes the callback so its query cannot leak into /login's", () => {
    const path = loginPathWithCallback(
      "/api/countrysnapshots/fork?country=TO,WS&theme=health",
    );
    const url = new URL(path, "https://surfer.example");
    expect([...url.searchParams.keys()]).toEqual(["callbackUrl"]);
  });

  it("falls back to / for anything that is not a same-origin path", () => {
    for (const unsafe of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example/x",
      "countrysnapshots",
      "",
    ]) {
      expect(loginPathWithCallback(unsafe)).toBe("/login?callbackUrl=%2F");
    }
  });
});
