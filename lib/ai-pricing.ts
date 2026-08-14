export interface AiModelTokenRates {
  input: number;
  output: number;
}

const DEFAULT_AI_MODEL_COSTS_USD_PER_MILLION: Record<string, AiModelTokenRates> = {
  'gpt-5.6': { input: 5, output: 30 },
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
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null;
  const rates = configuredRates()[model];
  if (!rates) return null;
  return Number((((inputTokens * rates.input) + (outputTokens * rates.output)) / 1_000_000).toFixed(6));
}
