/**
 * Sanitize UI messages after a DB round-trip.
 *
 * The Anthropic API requires tool_use.input to be a dict.  When messages pass
 * through JSON → Postgres JSONB → JSON, nested objects inside tool-call parts
 * can end up stringified, null, or undefined.  This function repairs them
 * before the messages are handed to `convertToModelMessages`.
 */
export function sanitizeToolInputs(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const parts = msg.parts as Array<Record<string, unknown>> | undefined;
    if (!parts) return msg;

    const fixedParts = parts.map((part) => {
      const ptype = part.type as string | undefined;
      if (ptype?.startsWith("tool-") || ptype === "dynamic-tool") {
        const inp = part.input;
        if (typeof inp === "string") {
          try {
            return { ...part, input: JSON.parse(inp) };
          } catch {
            // Unparseable string — replace with empty dict so the API call
            // doesn't crash.  The tool result will be wrong but the
            // conversation can at least continue.
            return { ...part, input: {} };
          }
        }
        if (inp === null || inp === undefined) {
          return { ...part, input: {} };
        }
      }
      return part;
    });

    return { ...msg, parts: fixedParts };
  });
}
