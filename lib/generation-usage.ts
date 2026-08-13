import type { GenerationModelCallTrace } from './types';

export interface GenerationUsageSummary {
  logicalCalls: number;
  providerAttempts: number;
  fallbackAttempts: number;
  timeoutAttempts: number;
  unknownTokenAttempts: number;
  unknownCostAttempts: number;
  unknownCostCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number | null;
  costDataStatus: 'complete' | 'partial' | 'missing';
}

export function summarizeGenerationUsage(calls: GenerationModelCallTrace[]): GenerationUsageSummary {
  let providerAttempts = 0;
  let fallbackAttempts = 0;
  let timeoutAttempts = 0;
  let unknownTokenAttempts = 0;
  let unknownCostAttempts = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let knownCostUsd = 0;
  let unknownCostCalls = 0;

  const addAttempt = (attempt: {
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: number | null;
  }) => {
    providerAttempts += 1;
    if (typeof attempt.inputTokens === 'number') totalInputTokens += attempt.inputTokens;
    if (typeof attempt.outputTokens === 'number') totalOutputTokens += attempt.outputTokens;
    if (typeof attempt.inputTokens !== 'number' || typeof attempt.outputTokens !== 'number') {
      unknownTokenAttempts += 1;
    }
    if (typeof attempt.estimatedCostUsd === 'number') knownCostUsd += attempt.estimatedCostUsd;
    else unknownCostAttempts += 1;
  };

  for (const call of calls) {
    const fallbacks = call.fallbackAttempts || [];
    const countedFinalAttempt = call.succeeded || (fallbacks.length === 0 && call.provider && call.model);
    const attempts = [
      ...fallbacks,
      ...(countedFinalAttempt ? [call] : []),
    ];
    if (attempts.length === 0 || attempts.some((attempt) => typeof attempt.estimatedCostUsd !== 'number')) {
      unknownCostCalls += 1;
    }
    for (const attempt of fallbacks) {
      fallbackAttempts += 1;
      if (attempt.reason === 'timeout') timeoutAttempts += 1;
      addAttempt(attempt);
    }

    if (countedFinalAttempt) {
      addAttempt(call);
    }
  }

  const costDataStatus = providerAttempts > 0 && unknownCostAttempts === 0
    ? 'complete'
    : providerAttempts > unknownCostAttempts
      ? 'partial'
      : 'missing';

  return {
    logicalCalls: calls.length,
    providerAttempts,
    fallbackAttempts,
    timeoutAttempts,
    unknownTokenAttempts,
    unknownCostAttempts,
    unknownCostCalls,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd: costDataStatus === 'complete' ? Number(knownCostUsd.toFixed(6)) : null,
    costDataStatus,
  };
}
