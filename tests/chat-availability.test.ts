import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMock = vi.fn();
const checkChatAllowedMock = vi.fn();
const getModelForUserMock = vi.fn();
const createMCPClientMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/db", () => ({ db: {}, dashboardSessions: {} }));
vi.mock("@/lib/usage-caps", () => ({
  checkChatAllowed: (...args: unknown[]) => checkChatAllowedMock(...args),
}));
vi.mock("@/lib/model-router", () => ({
  getModelForUser: (...args: unknown[]) => getModelForUserMock(...args),
  STREAM_TIMEOUT: 1000,
}));
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

import {
  chatDisabled,
  isChatDisabledError,
  CHAT_DISABLED_MESSAGE,
} from "@/lib/chat-availability";
import { POST } from "@/app/api/chat/route";

const APP = "http://localhost:3000";

function chatRequest(): Request {
  return new Request(APP + "/api/chat", {
    method: "POST",
    headers: { origin: APP, "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
}

describe("chatDisabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless AI_CHAT_DISABLED is exactly 1", () => {
    vi.stubEnv("AI_CHAT_DISABLED", "");
    expect(chatDisabled()).toBe(false);
    vi.stubEnv("AI_CHAT_DISABLED", "0");
    expect(chatDisabled()).toBe(false);
    vi.stubEnv("AI_CHAT_DISABLED", "1");
    expect(chatDisabled()).toBe(true);
  });
});

describe("isChatDisabledError", () => {
  it("recognises the kill-switch body the AI SDK puts in error.message", () => {
    const body = JSON.stringify({
      error: "chat_disabled",
      message: CHAT_DISABLED_MESSAGE,
    });
    expect(isChatDisabledError(body)).toBe(true);
    expect(isChatDisabledError('{"error":"global_budget"}')).toBe(false);
    expect(isChatDisabledError(null)).toBe(false);
  });
});

describe("POST /api/chat with the kill switch on", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_URL", APP);
    vi.stubEnv("AI_CHAT_DISABLED", "1");
    authMock.mockReset();
    checkChatAllowedMock.mockReset();
    getModelForUserMock.mockReset();
    createMCPClientMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 503 chat_disabled without touching the model or MCP", async () => {
    authMock.mockResolvedValue({ user: { userId: "u-1", role: "user" } });
    const res = await POST(chatRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "chat_disabled",
      message: "The AI assistant is temporarily unavailable.",
    });
    expect(checkChatAllowedMock).not.toHaveBeenCalled();
    expect(getModelForUserMock).not.toHaveBeenCalled();
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });

  it("still checks sign-in first", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(chatRequest());
    expect(res.status).toBe(401);
  });
});
