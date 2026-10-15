export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

// Pricing per million tokens (USD)
export const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-sonnet-5-5': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-haiku-5-5': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'gemini-3.6-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-3.8-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'fake-planner': { inputPerMillion: 0.0, outputPerMillion: 0.0 },
  'fake-worker': { inputPerMillion: 0.0, outputPerMillion: 0.0 },
  'default': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
};

export function calculateLlmCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING_TABLE[model] || PRICING_TABLE['default'];
  const costIn = (tokensIn / 1_000_000) * pricing.inputPerMillion;
  const costOut = (tokensOut / 1_000_000) * pricing.outputPerMillion;
  return Number((costIn + costOut).toFixed(6));
}
