import { describe, expect, it } from "vitest";
import {
  describeDomainRules,
  parseUnverifiedSignupDomains,
  unverifiedSignupAllows,
} from "@/lib/unverified-signup";

describe("parseUnverifiedSignupDomains", () => {
  it("is empty (feature off) when unset or blank", () => {
    expect(parseUnverifiedSignupDomains(undefined)).toEqual({ rules: [], dropped: [] });
    expect(parseUnverifiedSignupDomains("")).toEqual({ rules: [], dropped: [] });
    expect(parseUnverifiedSignupDomains(" , ,")).toEqual({ rules: [], dropped: [] });
  });

  it("keeps exact and suffix rules, normalised and deduplicated", () => {
    expect(
      parseUnverifiedSignupDomains(" MFAT.govt.nz , @stats.govt.nz., .govt.nz,mfat.govt.nz").rules,
    ).toEqual(["mfat.govt.nz", "stats.govt.nz", ".govt.nz"]);
  });

  it("drops invalid entries and reports them", () => {
    const { rules, dropped } = parseUnverifiedSignupDomains(
      "mfat.govt.nz,.nz,gmail.com,.com,localhost,not a domain",
    );
    expect(rules).toEqual(["mfat.govt.nz"]);
    expect(dropped.map((d) => d.rule)).toEqual([".nz", "gmail.com", ".com", "localhost", "not a domain"]);
    for (const d of dropped) expect(d.problem).toBeTruthy();
  });
});

describe("unverifiedSignupAllows", () => {
  const rules = ["mfat.govt.nz", ".stats.example.org"];

  it("admits an exact domain match, ignoring case and whitespace", () => {
    expect(unverifiedSignupAllows("jane@mfat.govt.nz", rules)).toBe(true);
    expect(unverifiedSignupAllows("  Jane@MFAT.Govt.NZ ", rules)).toBe(true);
  });

  it("does not let an exact rule admit subdomains", () => {
    expect(unverifiedSignupAllows("jane@x.mfat.govt.nz", rules)).toBe(false);
  });

  it("admits hosts under a suffix rule but not its apex", () => {
    expect(unverifiedSignupAllows("a@nz.stats.example.org", rules)).toBe(true);
    expect(unverifiedSignupAllows("a@stats.example.org", rules)).toBe(false);
    expect(unverifiedSignupAllows("a@xstats.example.org", rules)).toBe(false);
  });

  it("refuses other domains, malformed addresses and an empty rule list", () => {
    expect(unverifiedSignupAllows("jane@govt.nz", rules)).toBe(false);
    expect(unverifiedSignupAllows("jane@gmail.com", rules)).toBe(false);
    expect(unverifiedSignupAllows("jane@mfat.govt.nz@evil.com", rules)).toBe(false);
    expect(unverifiedSignupAllows("mfat.govt.nz", rules)).toBe(false);
    expect(unverifiedSignupAllows("jane@mfat.govt.nz", [])).toBe(false);
  });
});

describe("describeDomainRules", () => {
  it("reads exact and suffix rules as a phrase", () => {
    expect(describeDomainRules(["mfat.govt.nz"])).toBe("mfat.govt.nz");
    expect(describeDomainRules(["mfat.govt.nz", "spc.int", ".govt.nz"])).toBe(
      "mfat.govt.nz, spc.int or any subdomain of govt.nz",
    );
  });
});
