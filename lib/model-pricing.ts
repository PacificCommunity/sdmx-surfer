/**
 * Model pricing in USD per million tokens.
 * Updated March 2026.
 */

interface ModelPrice {
  input: number;  // $/MTok
  output: number; // $/MTok
}

const PRICING: Record<string, ModelPrice> = {
  // Anthropic
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  // OpenAI
  "gpt-4.1-nano": { input: 0.05, output: 0.20 },
  "gpt-4.1-mini": { input: 0.20, output: 0.80 },
  "gpt-5.4": { input: 2.50, output: 15.0 },
  // Google
  "gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "gemini-3-flash-preview": { input: 0.50, output: 3.0 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
};

/**
 * Estimate the cost of a request in USD.
 * Returns 0 if the model is unknown or tokens are missing.
 */
export function estimateCost(
  modelId: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const price = PRICING[modelId];
  if (!price) return 0;
  const inp = (inputTokens ?? 0) / 1_000_000 * price.input;
  const out = (outputTokens ?? 0) / 1_000_000 * price.output;
  return inp + out;
}
