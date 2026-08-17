import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  bootstrapAdminEmails,
  githubEmailIsVerified,
  emailDomain,
  entraEmailIsVerified,
  isBootstrapAdmin,
  isInstitutionalEmail,
  isPersonalEmailDomain,
  normaliseDomain,
  openSignupProviders,
  signupIsOpenFor,
} from "@/lib/signup-policy";

const KEYS = ["AUTH_OPEN_SIGNUP_PROVIDERS", "AUTH_BOOTSTRAP_ADMINS"];
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

describe("Microsoft email verification", () => {
  const CONSUMER = "9188040d-6c67-4c5b-b112-36a304b66dad";

  it("accepts a tenant that has proved it owns the domain", () => {
    expect(entraEmailIsVerified({ xms_edov: true, tid: "some-tenant" })).toBe(
      true,
    );
    // Entra has emitted the claim as a string as well as a boolean.
    expect(entraEmailIsVerified({ xms_edov: "true", tid: "some-tenant" })).toBe(
      true,
    );
  });

  it("refuses a tenant asserting a domain it has not proved", () => {
    // nOAuth: a free tenant sets a user's mail to an address it does not own.
    // Refused before any rule, so it can neither link to an existing account
    // nor pass the allowed_domains check on the strength of that address.
    expect(entraEmailIsVerified({ tid: "attacker-tenant" })).toBe(false);
    expect(
      entraEmailIsVerified({ xms_edov: false, tid: "attacker-tenant" }),
    ).toBe(false);
    // A string that is not "true" is not a yes.
    expect(entraEmailIsVerified({ xms_edov: "false" })).toBe(false);
    expect(entraEmailIsVerified({ xms_edov: "" })).toBe(false);
  });

  it("accepts personal accounts, whose addresses Microsoft verifies", () => {
    expect(entraEmailIsVerified({ tid: CONSUMER })).toBe(true);
  });

  it("fails closed when the claim was never configured", () => {
    // The likely misconfiguration: xms_edov not enabled on the registration.
    // Microsoft sign-in stops rather than trusting whatever arrives.
    expect(entraEmailIsVerified({})).toBe(false);
    expect(entraEmailIsVerified(null)).toBe(false);
    expect(entraEmailIsVerified(undefined)).toBe(false);
  });
});

describe("open signup", () => {
  it("is closed for every provider by default", () => {
    expect(openSignupProviders()).toEqual(new Set());
    for (const p of ["google", "microsoft-entra-id", "github", "email"]) {
      expect(signupIsOpenFor(p)).toBe(false);
    }
  });

  it("opens only the providers it names", () => {
    // The intended rollout: the two institutional providers open, GitHub not.
    process.env.AUTH_OPEN_SIGNUP_PROVIDERS = "google,microsoft-entra-id";
    expect(signupIsOpenFor("google")).toBe(true);
    expect(signupIsOpenFor("microsoft-entra-id")).toBe(true);
    expect(signupIsOpenFor("github")).toBe(false);
  });

  it("never opens the paths into our own account table", () => {
    // The point of scoping this per provider. Opening the magic link would
    // admit anyone with any working address, which is what allowed_domains and
    // the invite list exist to prevent.
    process.env.AUTH_OPEN_SIGNUP_PROVIDERS = "email,credentials,google";
    expect(signupIsOpenFor("email")).toBe(false);
    expect(signupIsOpenFor("credentials")).toBe(false);
    // The recognised entry alongside them still takes effect.
    expect(signupIsOpenFor("google")).toBe(true);
  });

  it("ignores an unrecognised entry rather than guessing at it", () => {
    process.env.AUTH_OPEN_SIGNUP_PROVIDERS = "gogle,azure-ad";
    expect(openSignupProviders()).toEqual(new Set());
  });

  it("tolerates spacing and case but not a missing provider", () => {
    process.env.AUTH_OPEN_SIGNUP_PROVIDERS = " Google , , MICROSOFT-ENTRA-ID ";
    expect(openSignupProviders()).toEqual(
      new Set(["google", "microsoft-entra-id"]),
    );
    // Auth.js supplies `account` on every path we register, so an absent
    // provider is something unrecognised and belongs on the lists.
    expect(signupIsOpenFor(undefined)).toBe(false);
    expect(signupIsOpenFor(null)).toBe(false);
    expect(signupIsOpenFor("")).toBe(false);
  });
});

describe("break-glass administrators", () => {
  it("is empty unless configured, so it grants nothing by default", () => {
    expect(bootstrapAdminEmails()).toEqual([]);
    expect(isBootstrapAdmin("anyone@example.com")).toBe(false);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    process.env.AUTH_BOOTSTRAP_ADMINS = " Me@Gvdallariva.net , gi@spc.int ";
    expect(bootstrapAdminEmails()).toEqual([
      "me@gvdallariva.net",
      "gi@spc.int",
    ]);
    expect(isBootstrapAdmin("ME@GVDALLARIVA.NET")).toBe(true);
    expect(isBootstrapAdmin(" gi@spc.int ")).toBe(true);
  });

  it("ignores entries that are not addresses", () => {
    // A bare domain here would read as "everyone at this organisation is an
    // administrator", which is not what this is for.
    process.env.AUTH_BOOTSTRAP_ADMINS = "spc.int,,   ,me@spc.int";
    expect(bootstrapAdminEmails()).toEqual(["me@spc.int"]);
    expect(isBootstrapAdmin("anyone@spc.int")).toBe(false);
  });

  it("does not admit a lookalike of a listed address", () => {
    process.env.AUTH_BOOTSTRAP_ADMINS = "me@spc.int";
    expect(isBootstrapAdmin("me@spc.int.example.com")).toBe(false);
    expect(isBootstrapAdmin("me@notspc.int")).toBe(false);
    expect(isBootstrapAdmin("notme@spc.int")).toBe(false);
  });
});

describe("github address verification", () => {
  const payload = [
    { email: "personal@gmail.com", primary: true, verified: true },
    { email: "someone@spc.int", primary: false, verified: false },
    { email: "real@spc.int", primary: false, verified: true },
  ];

  it("accepts an address that is verified on the account", () => {
    expect(githubEmailIsVerified(payload, "real@spc.int")).toBe(true);
    expect(githubEmailIsVerified(payload, "REAL@SPC.INT")).toBe(true);
  });

  it("refuses an unverified address, however it is flagged", () => {
    // The attack this closes: claim an address at a listed institutional
    // domain without owning it. Auth.js does not check `verified`, so an
    // unverified entry would otherwise be admitted by the domain rule and,
    // because accounts link on email, attach to whoever already owns it.
    expect(githubEmailIsVerified(payload, "someone@spc.int")).toBe(false);
  });

  it("refuses an address that is not on the account at all", () => {
    expect(githubEmailIsVerified(payload, "nobody@spc.int")).toBe(false);
  });

  it("fails closed on anything it does not understand", () => {
    for (const bad of [null, undefined, {}, "", 42, [null], [{}]]) {
      expect(githubEmailIsVerified(bad, "real@spc.int")).toBe(false);
    }
    // A truthy-but-not-true verified flag is not verification.
    expect(
      githubEmailIsVerified([{ email: "x@spc.int", verified: "true" }], "x@spc.int"),
    ).toBe(false);
    expect(githubEmailIsVerified(payload, "")).toBe(false);
  });
});
