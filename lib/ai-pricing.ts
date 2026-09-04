export interface AiModelTokenRates {
  input: number;
  output: number;
}

const DEFAULT_AI_MODEL_COSTS_USD_PER_MILLION: Record<string, AiModelTokenRates> = {
  // Standard API rates, verified 2026-09-04. Estimates use uncached input;
  // provider invoices may include cache-read/write adjustments.
  'gpt-6-astra': { input: 10, output: 50 },
  // gpt-5.6 routes to Sol. Promotional $4/$20 rates apply at least through
  // 2026-11-21; reverify before changing them after that date.
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  'gpt-5.6': { input: 4, output: 20 },
  'gpt-5.6-sol': { input: 4, output: 20 },
  'gpt-5.5': { input: 5, output: 30 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

function configuredRates(): Record<string, AiModelTokenRates> {
  const raw = process.env.AI_MODEL_COSTS_USD_PER_MILLION_JSON;
  if (!raw) return DEFAULT_AI_MODEL_COSTS_USD_PER_MILLION;
  try {
    const parsed = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
    const overrides = Object.fromEntries(Object.entries(parsed).flatMap(([model, rates]) => (
      typeof rates?.input === 'number' && typeof rates.output === 'number'
        && Number.isFinite(rates.input) && rates.input >= 0 && Number.isFinite(rates.output) && rates.output >= 0
        ? [[model, { input: rates.input, output: rates.output } satisfies AiModelTokenRates]]
        : []
    )));
    return { ...DEFAULT_AI_MODEL_COSTS_USD_PER_MILLION, ...overrides };
  } catch {
    return DEFAULT_AI_MODEL_COSTS_USD_PER_MILLION;
  }
}

export function hasAiModelPricing(model: string | null | undefined): boolean {
  return Boolean(model && configuredRates()[model]);
}

export function estimateAiUsageCostUsd(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number'
    || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  const rates = configuredRates()[model];
  if (!rates) return null;
  // These models apply the multipliers to the entire request above 272K input.
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  // https://developers.openai.com/api/docs/models/gpt-5.5
  const longContext = ['gpt-6-astra', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.5'].includes(model) && inputTokens > 272_000;
  return Number((((inputTokens * rates.input * (longContext ? 2 : 1)) + (outputTokens * rates.output * (longContext ? 1.5 : 1))) / 1_000_000).toFixed(6));
}
