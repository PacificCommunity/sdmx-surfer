import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  allowedEmailDomains,
  isInstitutionalEmail,
  openSignupEnabled,
  signupBasisWithoutInviteList,
} from "@/lib/signup-policy";

const KEYS = ["AUTH_ALLOWED_EMAIL_DOMAINS", "AUTH_OPEN_SIGNUP"];
const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("institutional domain rule", () => {
  it("parses a list tolerantly", () => {
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = " SPC.int, @statsfiji.gov.fj ,,un.org ";
    expect(allowedEmailDomains()).toEqual([
      "spc.int",
      "statsfiji.gov.fj",
      "un.org",
    ]);
  });

  it("admits the domain and its subdomains", () => {
    const d = ["spc.int"];
    expect(isInstitutionalEmail("someone@spc.int", d)).toBe(true);
    expect(isInstitutionalEmail("someone@mail.spc.int", d)).toBe(true);
    expect(isInstitutionalEmail("SOMEONE@SPC.INT", d)).toBe(true);
  });

  it("refuses a lookalike domain anyone could register", () => {
    // The reason the match is anchored on a dot rather than endsWith: these
    // are registrable, and a naive suffix test hands out accounts.
    const d = ["spc.int"];
    expect(isInstitutionalEmail("attacker@notspc.int", d)).toBe(false);
    expect(isInstitutionalEmail("attacker@spc.int.example.com", d)).toBe(false);
    expect(isInstitutionalEmail("attacker@xspc.int", d)).toBe(false);
  });

  it("is not fooled by an address containing the domain elsewhere", () => {
    const d = ["spc.int"];
    expect(isInstitutionalEmail("spc.int@gmail.com", d)).toBe(false);
    // Only the part after the LAST @ counts.
    expect(isInstitutionalEmail("a@spc.int@gmail.com", d)).toBe(false);
    expect(isInstitutionalEmail("a@b@spc.int", d)).toBe(true);
  });

  it("rejects malformed addresses rather than guessing", () => {
    const d = ["spc.int"];
    for (const bad of ["", "spc.int", "@spc.int", "someone@", "someone"]) {
      expect(isInstitutionalEmail(bad, d)).toBe(false);
    }
  });

  it("admits nobody when no domains are configured", () => {
    expect(allowedEmailDomains()).toEqual([]);
    expect(isInstitutionalEmail("someone@spc.int")).toBe(false);
  });
});

describe("signup basis", () => {
  it("defers to the invite list when no rule applies", () => {
    // null means "the caller must still check the database", which is what
    // keeps existing invited users on personal addresses working.
    expect(signupBasisWithoutInviteList("someone@gmail.com")).toBeNull();
  });

  it("settles an institutional address without a database read", () => {
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = "spc.int";
    expect(signupBasisWithoutInviteList("someone@spc.int")).toBe("domain");
  });

  it("open signup admits everyone and outranks the rest", () => {
    process.env.AUTH_OPEN_SIGNUP = "true";
    expect(openSignupEnabled()).toBe(true);
    expect(signupBasisWithoutInviteList("anyone@example.com")).toBe("open");
  });

  it("keeps signup closed unless the value is exactly true", () => {
    for (const v of ["TRUE", "1", "yes", ""]) {
      process.env.AUTH_OPEN_SIGNUP = v;
      expect(openSignupEnabled()).toBe(false);
      expect(signupBasisWithoutInviteList("anyone@example.com")).toBeNull();
    }
  });
});
