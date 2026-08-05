import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  emailDomain,
  isInstitutionalEmail,
  isPersonalEmailDomain,
  normaliseDomain,
  openSignupEnabled,
} from "@/lib/signup-policy";

const ORIGINAL = process.env.AUTH_OPEN_SIGNUP;
beforeEach(() => delete process.env.AUTH_OPEN_SIGNUP);
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTH_OPEN_SIGNUP;
  else process.env.AUTH_OPEN_SIGNUP = ORIGINAL;
});

describe("emailDomain", () => {
  it("reads the host from after the last @", () => {
    expect(emailDomain("someone@spc.int")).toBe("spc.int");
    expect(emailDomain("SOMEONE@SPC.INT")).toBe("spc.int");
    // The last @ is what a mail system routes on. Reading the first would let
    // this address pass as SPC.
    expect(emailDomain("a@spc.int@evil.com")).toBe("evil.com");
  });

  it("returns null rather than guessing at a malformed address", () => {
    for (const bad of ["", "spc.int", "@spc.int", "someone@", "someone"]) {
      expect(emailDomain(bad)).toBeNull();
    }
  });
});

describe("institutional domain matching", () => {
  const domains = ["spc.int", "statsfiji.gov.fj"];

  it("admits a listed domain", () => {
    expect(isInstitutionalEmail("someone@spc.int", domains)).toBe(true);
    expect(isInstitutionalEmail("  SOMEONE@SPC.INT  ", domains)).toBe(true);
  });

  it("refuses a lookalike anyone could register", () => {
    // This is the reason the comparison is exact rather than a suffix test.
    expect(isInstitutionalEmail("attacker@notspc.int", domains)).toBe(false);
    expect(isInstitutionalEmail("attacker@xspc.int", domains)).toBe(false);
    expect(isInstitutionalEmail("attacker@spc.int.example.com", domains)).toBe(false);
  });

  it("refuses subdomains, which are not granted by a listed domain", () => {
    // Decided: a subdomain grant reads smaller than it is, so a domain that
    // needs one gets its own row and somebody chooses to put it there.
    expect(isInstitutionalEmail("someone@mail.spc.int", domains)).toBe(false);
    expect(isInstitutionalEmail("someone@a.b.spc.int", domains)).toBe(false);
  });

  it("is not fooled by the domain appearing in the local part", () => {
    expect(isInstitutionalEmail("spc.int@gmail.com", domains)).toBe(false);
  });

  it("admits nobody when the table is empty", () => {
    expect(isInstitutionalEmail("someone@spc.int", [])).toBe(false);
  });

  it("normalises stored domains so a stray @ or dot cannot break a match", () => {
    expect(normaliseDomain(" @SPC.int. ")).toBe("spc.int");
    expect(isInstitutionalEmail("someone@spc.int", ["@SPC.INT"])).toBe(true);
  });
});

describe("personal domain guard", () => {
  it("names the consumer domains that must never be admitted wholesale", () => {
    // gmail.com and outlook.com are both present in the real user table, so
    // this is a live mistake to make, not a hypothetical one.
    for (const d of ["gmail.com", "outlook.com", "GMAIL.COM", " yahoo.com "]) {
      expect(isPersonalEmailDomain(d)).toBe(true);
    }
  });

  it("leaves institutional domains alone", () => {
    for (const d of ["spc.int", "stats.govt.nz", "mfat.govt.nz"]) {
      expect(isPersonalEmailDomain(d)).toBe(false);
    }
  });
});

describe("open signup", () => {
  it("is closed by default and opens only on the exact value", () => {
    expect(openSignupEnabled()).toBe(false);
    process.env.AUTH_OPEN_SIGNUP = "true";
    expect(openSignupEnabled()).toBe(true);
    for (const v of ["TRUE", "1", "yes", ""]) {
      process.env.AUTH_OPEN_SIGNUP = v;
      expect(openSignupEnabled()).toBe(false);
    }
  });
});
