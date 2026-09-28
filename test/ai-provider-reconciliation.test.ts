import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiBudgetDay, committedAiSpend, type AiSpendAttempt, type AiSpendLedger } from '@/lib/ai-budget';
import { getAiOperationalState, mutateAiOperationalState, saveGenerationRun } from '@/lib/kv-storage';
import type { GenerationRunTrace } from '@/lib/types';

const provider = vi.hoisted(() => ({ retrieve: vi.fn(), create: vi.fn(), clients: vi.fn() }));
vi.mock('openai', () => ({ default: class {
  constructor() { provider.clients(); }
  responses = { retrieve: provider.retrieve, create: provider.create };
} }));
import { generateText, reconcileAiProviderAttempts } from '@/lib/ai';

beforeEach(() => {
  vi.clearAllMocks();
  provider.retrieve.mockReset();
  provider.create.mockReset();
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

async function seed(patch: Partial<AiSpendAttempt> = {}) {
  const agentId = `provider-reconciliation-${crypto.randomUUID()}`;
  const attempt: AiSpendAttempt = { id: 'attempt', runId: 'original-job', requestKey: 'paid-stage', operation: 'generation',
    task: 'copy_judgment', provider: 'openai', model: 'gpt-6-astra', responseId: 'resp_saved', day: aiBudgetDay(),
    reservedUsd: .75, observedUsd: null, state: 'dispatched', createdAt: new Date(Date.now() - 20 * 60_000).toISOString(), ...patch };
  await mutateAiOperationalState<AiSpendLedger, void>(agentId, 'spend', () => ({
    value: { version: 'account-budget-1', day: attempt.day, attempts: { [attempt.id]: attempt } }, result: undefined,
  }));
  const read = async () => (await getAiOperationalState<AiSpendLedger>(agentId, 'spend'))!.attempts[attempt.id];
  return { agentId, attempt, read };
}

describe('provider usage reconciliation', () => {
  it.each([true, false])('defers missing local credentials without poisoning a dispatched receipt (response ID present: %s)', async hasResponseId => {
    const fixture = await seed(hasResponseId ? {} : { responseId: undefined });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(await fixture.read()).toEqual(fixture.attempt);
    expect(committedAiSpend(await fixture.read())).toBe(.75);
    expect(provider.clients).not.toHaveBeenCalled();
    expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
    await expect(generateText({ system: 'Judge', prompt: 'Saved draft', maxTokens: 100,
      spendContext: { agentId: fixture.agentId, runId: fixture.attempt.runId, requestKey: fixture.attempt.requestKey, operation: 'generation' },
    })).rejects.toThrow('provider_pending');
    expect(Object.keys((await getAiOperationalState<AiSpendLedger>(fixture.agentId, 'spend'))!.attempts)).toEqual(['attempt']);
  });

  it('recovers the same paid response when credentials become available, without replacement generation', async () => {
    const fixture = await seed();
    await reconcileAiProviderAttempts(fixture.agentId);
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    provider.retrieve.mockResolvedValue({ id: 'resp_saved', status: 'completed', model: 'gpt-6-astra',
      output_text: 'Recovered paid result', usage: { input_tokens: 100, output_tokens: 20 } });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 1, unavailable: 0 });
    expect(provider.retrieve).toHaveBeenCalledExactlyOnceWith('resp_saved');
    expect(await fixture.read()).toMatchObject({ id: fixture.attempt.id, day: fixture.attempt.day,
      state: 'settled', reconciliationState: 'settled', inputTokens: 100, outputTokens: 20,
      recoveredResult: { text: 'Recovered paid result', spendAttemptId: fixture.attempt.id } });
    expect(committedAiSpend(await fixture.read())).toBeGreaterThan(0);
    expect(committedAiSpend(await fixture.read())).toBeLessThan(.75);
    expect(await generateText({ system: 'Judge', prompt: 'Saved draft', maxTokens: 100,
      spendContext: { agentId: fixture.agentId, runId: fixture.attempt.runId, requestKey: fixture.attempt.requestKey, operation: 'generation' },
    })).toMatchObject({ text: 'Recovered paid result', spendAttemptId: fixture.attempt.id });
    expect(provider.create).not.toHaveBeenCalled();
    expect(Object.keys((await getAiOperationalState<AiSpendLedger>(fixture.agentId, 'spend'))!.attempts)).toEqual(['attempt']);
  });

  it('retains the full commitment when the configured provider confirms the response is unavailable', async () => {
    const fixture = await seed();
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    provider.retrieve.mockRejectedValue(Object.assign(new Error('Response not found'), { status: 404 }));
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 1 });
    expect(await fixture.read()).toMatchObject({ state: 'dispatched', observedUsd: null, reconciliationState: 'unavailable', reconciliationReason: 'response_not_found' });
    expect(committedAiSpend(await fixture.read())).toBe(.75);
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(provider.retrieve).toHaveBeenCalledTimes(1);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('keeps credential rejection retryable without claiming the response was lost', async () => {
    const fixture = await seed();
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    provider.retrieve.mockRejectedValue(Object.assign(new Error('Authentication rejected'), { status: 401 }));
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(await fixture.read()).toEqual(fixture.attempt);
    expect(committedAiSpend(await fixture.read())).toBe(.75);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('still releases expired reservations that were never dispatched without provider credentials', async () => {
    const fixture = await seed({ state: 'reserved', responseId: undefined });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(await fixture.read()).toMatchObject({ state: 'released', observedUsd: 0, reason: 'expired_undispatched' });
    expect(committedAiSpend(await fixture.read())).toBe(0);
    expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('recovers a legacy ambiguous unavailable receipt only after credentials return', async () => {
    const fixture = await seed({ reconciliationState: 'unavailable' });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(await fixture.read()).toEqual(fixture.attempt);
    await expect(generateText({ system: 'Judge', maxTokens: 100,
      spendContext: { agentId: fixture.agentId, runId: fixture.attempt.runId, requestKey: fixture.attempt.requestKey, operation: 'generation' },
    })).rejects.toThrow('provider_pending');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    provider.retrieve.mockImplementation(async responseId => {
      expect(responseId).toBe('resp_saved');
      expect(await fixture.read()).toMatchObject({ state: 'dispatched', reconciliationState: 'pending', observedUsd: null });
      expect(committedAiSpend(await fixture.read())).toBe(.75);
      return { id: 'resp_saved', status: 'completed', model: 'gpt-6-astra',
        output_text: 'Recovered legacy result', usage: { input_tokens: 100, output_tokens: 20 } };
    });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 1, unavailable: 0 });
    expect(await fixture.read()).toMatchObject({ state: 'settled', reconciliationState: 'settled',
      recoveredResult: { text: 'Recovered legacy result', spendAttemptId: fixture.attempt.id } });
    expect(provider.retrieve).toHaveBeenCalledTimes(1);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each(['rate_limited', 'in_progress'] as const)('keeps migrated legacy recovery pending after %s', async condition => {
    const fixture = await seed({ reconciliationState: 'unavailable' });
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    if (condition === 'rate_limited') provider.retrieve.mockRejectedValue(Object.assign(new Error('Rate limited'), { status: 429 }));
    else provider.retrieve.mockResolvedValue({ status: 'in_progress' });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(await fixture.read()).toMatchObject({ state: 'dispatched', reconciliationState: 'pending', observedUsd: null });
    expect(committedAiSpend(await fixture.read())).toBe(.75);
    await expect(generateText({ system: 'Judge', maxTokens: 100,
      spendContext: { agentId: fixture.agentId, runId: fixture.attempt.runId, requestKey: fixture.attempt.requestKey, operation: 'generation' },
    })).rejects.toThrow('provider_pending');
    expect(provider.create).not.toHaveBeenCalled();
    provider.retrieve.mockResolvedValue({ status: 'completed', model: 'gpt-6-astra', output_text: 'Recovered', usage: { input_tokens: 100, output_tokens: 20 } });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 1, unavailable: 0 });
    expect(provider.retrieve).toHaveBeenCalledTimes(2);
  });

  it.each(['response_not_found', 'usage_unavailable'] as const)('records %s provenance after a legacy probe and retains its unresolved charge', async reason => {
    const fixture = await seed({ reconciliationState: 'unavailable' });
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    if (reason === 'response_not_found') provider.retrieve.mockRejectedValue(Object.assign(new Error('Response not found'), { status: 404 }));
    else provider.retrieve.mockResolvedValue({ status: 'completed', output_text: 'No usage receipt' });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 1 });
    expect(await fixture.read()).toMatchObject({ state: 'dispatched', reconciliationState: 'unavailable', reconciliationReason: reason, observedUsd: null });
    expect(committedAiSpend(await fixture.read())).toBe(.75);
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 0 });
    expect(provider.retrieve).toHaveBeenCalledTimes(1);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: 'anthropic' }, 'provider_unsupported'],
    [{ responseId: undefined }, 'response_id_missing'],
  ] as const)('records explicit unavailability provenance without inventing usage: %s', async (patch, reason) => {
    const fixture = await seed({ reconciliationState: 'unavailable', ...patch });
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 1 });
    expect(await fixture.read()).toMatchObject({ state: 'dispatched', reconciliationState: 'unavailable', reconciliationReason: reason, observedUsd: null });
    expect(committedAiSpend(await fixture.read())).toBe(.75);
    expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('never assigns a later matching trace response to an attempt whose own response ID is missing', async () => {
    const fixture = await seed({ responseId: undefined, reconciliationState: 'unavailable' });
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    await saveGenerationRun(fixture.agentId, { schemaVersion: 2, id: fixture.attempt.runId,
      agentId: fixture.agentId, startedAt: new Date().toISOString(), completedAt: null,
      modelCalls: [{ stage: fixture.attempt.task, model: fixture.attempt.model,
        requestedModel: fixture.attempt.model, responseProgress: { responseId: 'resp_later_different_attempt' } }],
    } as GenerationRunTrace);
    provider.retrieve.mockResolvedValue({ status: 'completed', model: 'gpt-6-astra',
      output_text: 'A different paid result', usage: { input_tokens: 100, output_tokens: 20 } });
    expect(await reconcileAiProviderAttempts(fixture.agentId)).toEqual({ settled: 0, unavailable: 1 });
    const attempt = await fixture.read();
    expect(attempt).toMatchObject({ state: 'dispatched', reconciliationState: 'unavailable',
      reconciliationReason: 'response_id_missing', observedUsd: null });
    expect(attempt.responseId).toBeUndefined();
    expect(attempt.recoveredResult).toBeUndefined();
    expect(committedAiSpend(attempt)).toBe(.75);
    expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });
});
