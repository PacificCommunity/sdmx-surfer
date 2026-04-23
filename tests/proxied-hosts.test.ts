import { describe, it, expect } from "vitest";
import { PROXIED_HOSTS, PROXIED_HOST_NAMES } from "@/lib/proxied-hosts";

describe("PROXIED_HOSTS allowlist", () => {
  it("exposes the same set of hosts in PROXIED_HOST_NAMES", () => {
    expect([...PROXIED_HOST_NAMES].sort()).toEqual(
      Object.keys(PROXIED_HOSTS).sort(),
    );
  });

  it("marks StatsNZ as a key-bearing host with the right env var and header", () => {
    const statsnz = PROXIED_HOSTS["api.data.stats.govt.nz"];
    expect(statsnz).toBeDefined();
    expect(statsnz.reason).toBe("key");
    expect(statsnz.key?.envVar).toBe("SDMX_STATSNZ_KEY");
    expect(statsnz.key?.header).toBe("Ocp-Apim-Subscription-Key");
  });

  it("marks Eurostat and OECD as CORS-only (no key injection)", () => {
    expect(PROXIED_HOSTS["ec.europa.eu"]?.reason).toBe("cors");
    expect(PROXIED_HOSTS["ec.europa.eu"]?.key).toBeUndefined();
    expect(PROXIED_HOSTS["sdmx.oecd.org"]?.reason).toBe("cors");
    expect(PROXIED_HOSTS["sdmx.oecd.org"]?.key).toBeUndefined();
  });

  describe("path allowlist", () => {
    function allows(host: string, pathname: string): boolean {
      const config = PROXIED_HOSTS[host];
      expect(config).toBeDefined();
      return config.allowedPathPattern.test(pathname);
    }

    it("allows Eurostat data paths like the one that broke in production", () => {
      // From the browser console trace: TSC00001 series that failed CORS.
      expect(
        allows(
          "ec.europa.eu",
          "/eurostat/api/dissemination/sdmx/2.1/data/TSC00001/A.PC_GDP.HES.",
        ),
      ).toBe(true);
      expect(
        allows(
          "ec.europa.eu",
          "/eurostat/api/dissemination/sdmx/3.0/data/SOMEFLOW/all",
        ),
      ).toBe(true);
    });

    it("blocks non-dissemination paths on the Eurostat host", () => {
      // The proxy allowlist must not turn the server into an open forwarder
      // for ec.europa.eu as a whole.
      expect(allows("ec.europa.eu", "/eurostat/databrowser/view/TSC00001")).toBe(
        false,
      );
      expect(allows("ec.europa.eu", "/about-the-european-commission")).toBe(
        false,
      );
    });

    it("allows OECD data paths like the ones the agent builds", () => {
      // Comma-form URL with sub-agency, as produced by build_data_url.
      expect(
        allows(
          "sdmx.oecd.org",
          "/public/rest/data/OECD.SDD.NAD,DSD_NAQLI@DF_QNA,1.0/A.AUT",
        ),
      ).toBe(true);
    });

    it("blocks non-rest paths on the OECD host", () => {
      expect(allows("sdmx.oecd.org", "/public/legal")).toBe(false);
    });

    it("allows StatsNZ /rest data paths", () => {
      expect(
        allows("api.data.stats.govt.nz", "/rest/data/DF_POP/A..T"),
      ).toBe(true);
    });
  });
});
