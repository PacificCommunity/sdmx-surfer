import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGatewayCredits } from "@/lib/gateway-credits";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchGatewayCredits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null without calling the gateway when the key is unset", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const fetchMock = stubFetch(Response.json({}));
    expect(await fetchGatewayCredits()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses the string amounts the gateway returns", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const fetchMock = stubFetch(
      Response.json({ balance: "36.87718", total_used: "288.12282" }),
    );
    expect(await fetchGatewayCredits()).toEqual({
      balanceUsd: 36.87718,
      totalUsedUsd: 288.12282,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai-gateway.vercel.sh/v1/credits",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-key" },
      }),
    );
  });

  it.each([
    ["non-numeric balance", { balance: "lots", total_used: "1" }],
    ["empty balance", { balance: "", total_used: "1" }],
    ["missing total_used", { balance: "1" }],
  ])("returns null on %s", async (_label, body) => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(Response.json(body));
    expect(await fetchGatewayCredits()).toBeNull();
  });

  it("returns null on HTTP errors and network failures", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(new Response("nope", { status: 401 }));
    expect(await fetchGatewayCredits()).toBeNull();
    stubFetch(new Error("timeout"));
    expect(await fetchGatewayCredits()).toBeNull();
  });
});
