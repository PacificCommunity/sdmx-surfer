import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EMAIL_PROOF_COMPLETION_MS,
  EMAIL_PROOF_COOKIE,
  emailProofCanComplete,
  emailProofConfig,
  emailProofCookieValue,
  emailProofStatus,
  emailProofVerdict,
  generateProofCode,
  hashProofSecret,
  newProofSecret,
  normaliseProofEmail,
  parseMailboxAddress,
  parseVerifyAddress,
  proofSecretFromCookieHeader,
  proofSecretMatches,
  verifyAddressFor,
  type EmailProofState,
} from "@/lib/email-proof";

const NOW = new Date("2026-11-06T10:00:00Z");
const MINUTE = 60 * 1000;

function proof(overrides: Partial<EmailProofState> = {}): EmailProofState {
  return {
    email: "jane@spc.int",
    expires_at: new Date(NOW.getTime() + 10 * MINUTE),
    verified_at: null,
    consumed_at: null,
    rejection: null,
    ...overrides,
  };
}

describe("parseVerifyAddress", () => {
  const domain = "in.sdmxsurfer.net";

  it("reads the code from a well-formed address", () => {
    expect(parseVerifyAddress("verify-abcde23456@in.sdmxsurfer.net", domain)).toBe("abcde23456");
  });

  it("is case-insensitive in local part and domain", () => {
    expect(parseVerifyAddress("VERIFY-ABCDE23456@IN.SdmxSurfer.NET", domain)).toBe("abcde23456");
  });

  it("accepts a display-name form", () => {
    expect(
      parseVerifyAddress("Surfer <verify-abcde23456@in.sdmxsurfer.net>", domain),
    ).toBe("abcde23456");
  });

  it("ignores other domains, including look-alike subdomains", () => {
    expect(parseVerifyAddress("verify-abcde23456@sdmxsurfer.net", domain)).toBeNull();
    expect(parseVerifyAddress("verify-abcde23456@x.in.sdmxsurfer.net", domain)).toBeNull();
    expect(parseVerifyAddress("verify-abcde23456@in.sdmxsurfer.net.evil.com", domain)).toBeNull();
  });

  it("refuses plus-addressing and garbage", () => {
    expect(parseVerifyAddress("verify-abcde23456+x@in.sdmxsurfer.net", domain)).toBeNull();
    expect(parseVerifyAddress("verify-abc@in.sdmxsurfer.net", domain)).toBeNull();
    expect(parseVerifyAddress("verify-abcde23451@in.sdmxsurfer.net", domain)).toBeNull();
    expect(parseVerifyAddress("hello@in.sdmxsurfer.net", domain)).toBeNull();
    expect(parseVerifyAddress("not an address", domain)).toBeNull();
    expect(parseVerifyAddress("", domain)).toBeNull();
  });

  it("round-trips a generated code", () => {
    const code = generateProofCode();
    expect(code).toMatch(/^[a-z2-7]{10}$/);
    expect(parseVerifyAddress(verifyAddressFor(code, domain), domain)).toBe(code);
  });
});

describe("parseMailboxAddress", () => {
  it("reads a bare address, lowercased", () => {
    expect(parseMailboxAddress("  Jane@SPC.int ")).toBe("jane@spc.int");
  });

  it("reads Name <addr>", () => {
    expect(parseMailboxAddress("Jane Doe <jane@spc.int>")).toBe("jane@spc.int");
  });

  it("is not fooled by an address inside a quoted display name", () => {
    expect(parseMailboxAddress('"Boss <boss@spc.int>" <eve@evil.example>')).toBe(
      "eve@evil.example",
    );
    expect(parseMailboxAddress('"Doe, Jane <x>" <jane@spc.int>')).toBe("jane@spc.int");
  });

  it("refuses multiple mailboxes and malformed values", () => {
    expect(parseMailboxAddress("a <a@spc.int>, b <b@spc.int>")).toBeNull();
    expect(parseMailboxAddress("a@spc.int, b@spc.int")).toBeNull();
    expect(parseMailboxAddress("Jane <jane@spc.int")).toBeNull();
    expect(parseMailboxAddress("<jane@spc.int> trailing")).toBeNull();
    expect(parseMailboxAddress('"jane"@spc.int')).toBeNull();
    expect(parseMailboxAddress("jane")).toBeNull();
  });
});

describe("normaliseProofEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseProofEmail("  Jane.Doe+surfer@Stats.Govt.NZ ")).toBe(
      "jane.doe+surfer@stats.govt.nz",
    );
  });

  it("refuses quotes, missing hosts and single-label hosts", () => {
    expect(normaliseProofEmail('"jane"@spc.int')).toBeNull();
    expect(normaliseProofEmail("jane@")).toBeNull();
    expect(normaliseProofEmail("jane@localhost")).toBeNull();
    expect(normaliseProofEmail("a@b@spc.int")).toBeNull();
  });
});

describe("emailProofVerdict", () => {
  const from = "Jane Doe <jane@spc.int>";

  it("verifies a DMARC pass from exactly the proved address", () => {
    expect(
      emailProofVerdict(proof(), { from, authentication: { dmarc: "pass" } }, NOW),
    ).toEqual({ verified: true });
  });

  it("matches the sender case-insensitively", () => {
    expect(
      emailProofVerdict(
        proof(),
        { from: "JANE@SPC.INT", authentication: { dmarc: "pass" } },
        NOW,
      ),
    ).toEqual({ verified: true });
  });

  it.each(["fail", "gray", "processing_failed", "unknown"])(
    "rejects DMARC %s",
    (dmarc) => {
      expect(
        emailProofVerdict(proof(), { from, authentication: { dmarc } }, NOW),
      ).toEqual({ verified: false, reason: "dmarc_not_pass" });
    },
  );

  it("rejects absent or null authentication", () => {
    for (const authentication of [null, undefined, {}, { dmarc: null }]) {
      expect(emailProofVerdict(proof(), { from, authentication }, NOW)).toEqual({
        verified: false,
        reason: "no_authentication",
      });
    }
  });

  it("rejects a different sender, even on the same domain", () => {
    for (const other of ["john@spc.int", "Jane <jane@spc.int.evil.com>", "jane+x@spc.int", "garbage"]) {
      expect(
        emailProofVerdict(proof(), { from: other, authentication: { dmarc: "pass" } }, NOW),
      ).toEqual({ verified: false, reason: "sender_mismatch" });
    }
  });

  it("rejects after expiry", () => {
    expect(
      emailProofVerdict(
        proof({ expires_at: new Date(NOW.getTime() - 1) }),
        { from, authentication: { dmarc: "pass" } },
        NOW,
      ),
    ).toEqual({ verified: false, reason: "expired" });
  });

  it("rejects a proof already verified, rejected or consumed", () => {
    const message = { from, authentication: { dmarc: "pass" } };
    for (const state of [
      { verified_at: NOW },
      { consumed_at: NOW },
      { rejection: "sender_mismatch" as const },
    ]) {
      expect(emailProofVerdict(proof(state), message, NOW)).toEqual({
        verified: false,
        reason: "already_used",
      });
    }
  });
});

describe("emailProofStatus / emailProofCanComplete", () => {
  it("is pending while waiting", () => {
    expect(emailProofStatus(proof(), NOW)).toEqual({ status: "pending" });
  });

  it("expires when the email never came", () => {
    expect(
      emailProofStatus(proof({ expires_at: new Date(NOW.getTime() - 1) }), NOW),
    ).toEqual({ status: "expired" });
  });

  it("stays completable for the completion window after verification", () => {
    const verified = proof({
      verified_at: new Date(NOW.getTime() - EMAIL_PROOF_COMPLETION_MS + MINUTE),
      expires_at: new Date(NOW.getTime() - MINUTE),
    });
    expect(emailProofCanComplete(verified, NOW)).toBe(true);
    expect(emailProofStatus(verified, NOW)).toEqual({ status: "verified" });

    const stale = proof({ verified_at: new Date(NOW.getTime() - EMAIL_PROOF_COMPLETION_MS) });
    expect(emailProofCanComplete(stale, NOW)).toBe(false);
    expect(emailProofStatus(stale, NOW)).toEqual({ status: "expired" });
  });

  it("cannot complete twice", () => {
    const consumed = proof({ verified_at: NOW, consumed_at: NOW });
    expect(emailProofCanComplete(consumed, NOW)).toBe(false);
    expect(emailProofStatus(consumed, NOW)).toEqual({ status: "expired" });
  });

  it("reports the rejection reason", () => {
    expect(emailProofStatus(proof({ rejection: "dmarc_not_pass" }), NOW)).toEqual({
      status: "rejected",
      reason: "dmarc_not_pass",
    });
  });
});

describe("browser secret", () => {
  it("matches only its own hash", () => {
    const secret = newProofSecret();
    const hash = hashProofSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(proofSecretMatches(secret, hash)).toBe(true);
    expect(proofSecretMatches(newProofSecret(), hash)).toBe(false);
    expect(proofSecretMatches(secret, "abc")).toBe(false);
  });

  it("is read from the cookie only for the matching proof id", () => {
    const id = "6f1c2d4e-0000-4000-8000-000000000000";
    const header =
      "other=1; " + EMAIL_PROOF_COOKIE + "=" + emailProofCookieValue(id, "s3cr3t_-x") + "; x=y";
    expect(proofSecretFromCookieHeader(header, id)).toBe("s3cr3t_-x");
    expect(proofSecretFromCookieHeader(header, "another-id")).toBeNull();
    expect(proofSecretFromCookieHeader(null, id)).toBeNull();
    expect(proofSecretFromCookieHeader(EMAIL_PROOF_COOKIE + "=" + id + ".", id)).toBeNull();
  });
});

describe("emailProofConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless domain, webhook secret and an API key are all set", () => {
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_x");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    expect(emailProofConfig()).toBeNull();

    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "In.SdmxSurfer.net");
    vi.stubEnv("RESEND_RECEIVING_API_KEY", "");
    expect(emailProofConfig()).toEqual({
      inboundDomain: "in.sdmxsurfer.net",
      webhookSecret: "whsec_x",
      receivingApiKey: "re_x",
    });

    vi.stubEnv("RESEND_RECEIVING_API_KEY", "re_receiving");
    expect(emailProofConfig()?.receivingApiKey).toBe("re_receiving");

    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect(emailProofConfig()).toBeNull();
  });
});
