import { describe, expect, it } from 'vitest';
import { summarizeGenerationUsage } from '@/lib/generation-usage';
import type { GenerationModelCallTrace } from '@/lib/types';

describe('generation usage accounting', () => {
  it('counts fallback attempts and their token spend instead of hiding them inside logical calls', () => {
    const calls: GenerationModelCallTrace[] = [{
      stage: 'tweet_writing',
      provider: 'openai',
      model: 'gpt-5.6',
      inputTokens: 80,
      outputTokens: 20,
      estimatedCostUsd: 0.008,
      durationMs: 200,
      succeeded: true,
      error: null,
      fallbackAttempts: [{
        provider: 'anthropic',
        model: 'claude-fable-5',
        reason: 'empty_text',
        stopReason: 'max_tokens',
        statusCode: null,
        errorType: null,
        inputTokens: 120,
        outputTokens: 40,
        estimatedCostUsd: 0.012,
        durationMs: 150,
      }],
    }];

    expect(summarizeGenerationUsage(calls)).toMatchObject({
      logicalCalls: 1,
      providerAttempts: 2,
      fallbackAttempts: 1,
      timeoutAttempts: 0,
      unknownCostCalls: 0,
      totalInputTokens: 200,
      totalOutputTokens: 60,
      estimatedCostUsd: 0.02,
      costDataStatus: 'complete',
    });
  });

  it('marks timeout spend unknown rather than reporting a false complete cost', () => {
    const calls: GenerationModelCallTrace[] = [{
      stage: 'copy_judgment',
      provider: 'openai',
      model: 'gpt-5.6',
      inputTokens: 50,
      outputTokens: 10,
      estimatedCostUsd: 0.004,
      durationMs: 1000,
      succeeded: true,
      error: null,
      fallbackAttempts: [{
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reason: 'timeout',
        stopReason: null,
        statusCode: null,
        errorType: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        durationMs: 900,
      }],
    }];

    expect(summarizeGenerationUsage(calls)).toMatchObject({
      providerAttempts: 2,
      timeoutAttempts: 1,
      unknownTokenAttempts: 1,
      unknownCostAttempts: 1,
      unknownCostCalls: 1,
      estimatedCostUsd: null,
      costDataStatus: 'partial',
    });
  });
});
