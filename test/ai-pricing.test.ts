import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateAiUsageCostUsd, hasAiModelPricing } from '@/lib/ai-pricing';

describe('GPT-5.6 Sol API pricing', () => {
  beforeEach(() => vi.stubEnv('AI_MODEL_COSTS_USD_PER_MILLION_JSON', ''));
  afterEach(() => vi.unstubAllEnvs());

  it.each(['gpt-5.6', 'gpt-5.6-sol'])('prices %s at the current $4 input/$20 output rates per million tokens', (model) => {
    expect(hasAiModelPricing(model)).toBe(true);
    expect(estimateAiUsageCostUsd(model, 1000, 0)).toBe(0.004);
    expect(estimateAiUsageCostUsd(model, 0, 1000)).toBe(0.02);
    expect(estimateAiUsageCostUsd(model, 1000, 1000)).toBe(0.024);
  });

  it.each(['gpt-5.6', 'gpt-5.6-sol'])('applies long-context rates to all %s tokens only above 272K input', (model) => {
    expect(estimateAiUsageCostUsd(model, 272000, 1000)).toBe(1.108);
    expect(estimateAiUsageCostUsd(model, 272001, 1000)).toBe(2.206008);
    expect(estimateAiUsageCostUsd(model, 300000, 1000)).toBe(2.43);
  });

  it('preserves Astra rates and does not assign Sol pricing to other GPT-5.6 family models', () => {
    expect(estimateAiUsageCostUsd('gpt-6-astra', 1000, 1000)).toBe(0.06);
    expect(estimateAiUsageCostUsd('gpt-6-astra', 300000, 1000)).toBe(6.075);
    for (const model of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol-mini']) {
      expect(hasAiModelPricing(model)).toBe(false);
      expect(estimateAiUsageCostUsd(model, 1000, 1000)).toBeNull();
    }
  });

  it('applies GPT-5.5 long-context multipliers without changing its $5/$30 standard rates', () => {
    expect(estimateAiUsageCostUsd('gpt-5.5', 1000, 1000)).toBe(0.035);
    expect(estimateAiUsageCostUsd('gpt-5.5', 272000, 1000)).toBe(1.39);
    expect(estimateAiUsageCostUsd('gpt-5.5', 272001, 1000)).toBe(2.76501);
    expect(estimateAiUsageCostUsd('gpt-5.5', 300000, 1000)).toBe(3.045);
  });

  it('retains valid explicit pricing overrides and rejects missing/invalid token counts', () => {
    vi.stubEnv('AI_MODEL_COSTS_USD_PER_MILLION_JSON', JSON.stringify({ 'gpt-5.6-sol': { input: 6, output: 25 } }));
    expect(estimateAiUsageCostUsd('gpt-5.6-sol', 1000, 1000)).toBe(0.031);
    expect(estimateAiUsageCostUsd('gpt-5.6', 1000, 1000)).toBe(0.024);
    for (const value of [null, undefined, -1, NaN, Infinity]) {
      expect(estimateAiUsageCostUsd('gpt-5.6-sol', value, 1000)).toBeNull();
      expect(estimateAiUsageCostUsd('gpt-5.6-sol', 1000, value)).toBeNull();
    }
  });
});
