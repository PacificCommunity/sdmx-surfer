/**
 * The AI chat kill switch. `AI_CHAT_DISABLED=1` makes every chat route
 * (builder, Country Snapshots chat and warm) refuse before any model or MCP
 * call; published dashboards, the gallery and sessions keep working.
 *
 * Shared by the routes and the chat UIs, so it must stay free of server-only
 * imports.
 */

export const CHAT_DISABLED_ERROR = "chat_disabled";
export const CHAT_DISABLED_MESSAGE =
  "The AI assistant is temporarily unavailable.";

export function chatDisabled(): boolean {
  return process.env.AI_CHAT_DISABLED === "1";
}

export function chatDisabledResponse(): Response {
  return Response.json(
    { error: CHAT_DISABLED_ERROR, message: CHAT_DISABLED_MESSAGE },
    { status: 503 },
  );
}

/**
 * True when a useChat error came from the kill switch. The AI SDK puts the
 * failed response's body text in `error.message`.
 */
export function isChatDisabledError(message: string | null | undefined): boolean {
  return Boolean(message?.includes('"' + CHAT_DISABLED_ERROR + '"'));
}
