import { describe, it, expect, vi, afterEach } from "vitest";
import { isEmailAdmitted, type AdmissionLookups } from "@/lib/admission";

function lookups(rules: string[], invited: string[]) {
  return {
    anyDomainRule: vi.fn(async (candidates: string[]) =>
      candidates.some((c) => rules.includes(c)),
    ),
    isInvited: vi.fn(async (email: string) => invited.includes(email)),
  };
}

describe("isEmailAdmitted", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("admits a break-glass administrator without consulting the lists", async () => {
    vi.stubEnv("AUTH_BOOTSTRAP_ADMINS", "boss@example.com");
    const l = lookups([], []);
    expect(await isEmailAdmitted(" Boss@Example.com ", l)).toBe(true);
    expect(l.anyDomainRule).not.toHaveBeenCalled();
    expect(l.isInvited).not.toHaveBeenCalled();
  });

  it("admits an exact domain row", async () => {
    expect(await isEmailAdmitted("a@spc.int", lookups(["spc.int"], []))).toBe(true);
  });

  it("admits a .suffix row covering the host", async () => {
    expect(await isEmailAdmitted("a@stats.govt.nz", lookups([".govt.nz"], []))).toBe(true);
  });

  it("does not let a suffix row admit the apex", async () => {
    expect(await isEmailAdmitted("a@govt.nz", lookups([".govt.nz"], []))).toBe(false);
  });

  it("passes the normalised address to the invite lookup", async () => {
    const l = lookups([], ["friend@gmail.com"]);
    expect(await isEmailAdmitted("Friend@Gmail.com", l)).toBe(true);
    expect(l.isInvited).toHaveBeenCalledWith("friend@gmail.com");
  });

  it("refuses an address on no list", async () => {
    expect(await isEmailAdmitted("x@evil.example", lookups(["spc.int"], []))).toBe(false);
  });

  it("degrades to the invite list when allowed_domains is unreadable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: AdmissionLookups = {
      anyDomainRule: async () => {
        throw new Error('relation "allowed_domains" does not exist');
      },
      isInvited: async (email) => email === "invited@spc.int",
    };
    expect(await isEmailAdmitted("invited@spc.int", broken)).toBe(true);
    expect(await isEmailAdmitted("other@spc.int", broken)).toBe(false);
  });
});
