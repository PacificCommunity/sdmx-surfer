import { describe, it, expect } from "vitest";
import { sanitizeToolInputs } from "@/lib/sanitize-messages";

describe("sanitizeToolInputs", () => {
  it("passes through text-only messages unchanged", () => {
    const messages = [
      {
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: "hi there" }],
      },
    ];

    const result = sanitizeToolInputs(messages);

    expect(result).toEqual(messages);
  });

  it("passes through tool parts with valid object input unchanged", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Let me search..." },
          {
            type: "tool-list_dataflows",
            toolCallId: "tc_1",
            state: "output-available",
            input: { keyword: "population" },
            output: { dataflows: [] },
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);

    expect(result[0].parts).toEqual(messages[0].parts);
  });

  it("parses stringified tool input back to object", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-build_data_url",
            toolCallId: "tc_2",
            state: "output-available",
            input: '{"dataflow":"DF_POP","key":"A.FJ"}',
            output: { url: "https://..." },
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const parts = result[0].parts as Array<Record<string, unknown>>;

    expect(parts[0].input).toEqual({ dataflow: "DF_POP", key: "A.FJ" });
    expect(typeof parts[0].input).toBe("object");
  });

  it("replaces null input with empty object", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-get_current_endpoint",
            toolCallId: "tc_3",
            state: "output-available",
            input: null,
            output: { endpoint: "SPC" },
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const parts = result[0].parts as Array<Record<string, unknown>>;

    expect(parts[0].input).toEqual({});
  });

  it("replaces undefined input with empty object", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-get_current_endpoint",
            toolCallId: "tc_4",
            state: "output-available",
            output: { endpoint: "SPC" },
            // input is missing (undefined)
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const parts = result[0].parts as Array<Record<string, unknown>>;

    expect(parts[0].input).toEqual({});
  });

  it("replaces unparseable string input with empty object", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-validate_query",
            toolCallId: "tc_5",
            state: "output-available",
            input: "not valid json {{{",
            output: {},
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const parts = result[0].parts as Array<Record<string, unknown>>;

    expect(parts[0].input).toEqual({});
  });

  it("handles dynamic-tool parts", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "tc_6",
            toolName: "custom_tool",
            state: "output-available",
            input: '{"foo":"bar"}',
            output: {},
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const parts = result[0].parts as Array<Record<string, unknown>>;

    expect(parts[0].input).toEqual({ foo: "bar" });
  });

  it("does not touch non-tool part types", () => {
    const messages = [
      {
        role: "assistant",
        parts: [
          { type: "text", text: "here is the result" },
          { type: "reasoning", text: "thinking..." },
          {
            type: "tool-update_dashboard",
            toolCallId: "tc_7",
            state: "output-available",
            input: '{"config":{"id":"test"}}',
            output: { success: true },
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const parts = result[0].parts as Array<Record<string, unknown>>;

    // Text and reasoning parts untouched
    expect(parts[0]).toEqual({ type: "text", text: "here is the result" });
    expect(parts[1]).toEqual({ type: "reasoning", text: "thinking..." });
    // Tool part fixed
    expect(parts[2].input).toEqual({ config: { id: "test" } });
  });

  it("handles messages without parts (e.g. system messages)", () => {
    const messages = [
      { role: "system", content: "You are helpful." },
    ];

    const result = sanitizeToolInputs(messages);

    expect(result).toEqual(messages);
  });

  it("fixes multiple corrupted tool parts in a conversation", () => {
    const messages = [
      {
        role: "user",
        parts: [{ type: "text", text: "show me population data" }],
      },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Let me find that..." },
          {
            type: "tool-list_dataflows",
            toolCallId: "tc_a",
            state: "output-available",
            input: '{"keyword":"population"}',
            output: { dataflows: ["DF_POP"] },
          },
          {
            type: "tool-get_dataflow_structure",
            toolCallId: "tc_b",
            state: "output-available",
            input: null,
            output: { dimensions: [] },
          },
          {
            type: "tool-build_data_url",
            toolCallId: "tc_c",
            state: "output-available",
            input: undefined,
            output: { url: "https://..." },
          },
        ],
      },
    ];

    const result = sanitizeToolInputs(messages);
    const assistantParts = result[1].parts as Array<Record<string, unknown>>;

    expect(assistantParts[1].input).toEqual({ keyword: "population" });
    expect(assistantParts[2].input).toEqual({});
    expect(assistantParts[3].input).toEqual({});
  });

  it("preserves other fields on tool parts when fixing input", () => {
    const original = {
      type: "tool-list_dataflows",
      toolCallId: "tc_preserve",
      state: "output-available",
      input: '{"keyword":"trade"}',
      output: { dataflows: ["DF_IMTS"] },
    };

    const messages = [{ role: "assistant", parts: [original] }];
    const result = sanitizeToolInputs(messages);
    const fixed = (result[0].parts as Array<Record<string, unknown>>)[0];

    expect(fixed.type).toBe("tool-list_dataflows");
    expect(fixed.toolCallId).toBe("tc_preserve");
    expect(fixed.state).toBe("output-available");
    expect(fixed.output).toEqual({ dataflows: ["DF_IMTS"] });
    expect(fixed.input).toEqual({ keyword: "trade" });
  });
});
