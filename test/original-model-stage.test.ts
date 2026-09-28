import { describe, expect, it, vi } from 'vitest';
import { runOriginalModelStage, originalModelRequestKey, type OriginalModelOptions } from '@/lib/original-model-stage';
import { claimGenerationJob, GenerationJobSession, getGenerationJob } from '@/lib/generation-job';
import { getAiOperationalState, mutateAiOperationalState } from '@/lib/kv-storage';
import { committedAiSpend, type AiSpendLedger } from '@/lib/ai-budget';
import type { GenerateTextOptions, GenerateTextResult } from '@/lib/ai';

const options: OriginalModelOptions = {
  system: 'Use the supplied evidence.', prompt: 'A specific subject.', maxTokens: 300,
  modelStack: 'publishing_v2_astra', temperature: 0.7, timeoutMs: 60_000,
  jsonSchema: { type: 'object', properties: { content: { type: 'string' } } },
};
const output: GenerateTextResult = { text: '{"content":"paid draft"}', stopReason: 'stop',
  provider: 'openai', model: 'gpt-6-astra', inputTokens: 100, outputTokens: 30 };
async function input(label: string) {
  const agentId = `original-stage-${label}-${crypto.randomUUID()}`;
  const session = new GenerationJobSession(agentId, (await claimGenerationJob(agentId, {}, 'policy'))!);
  return { session, stage: 'idea_generation' as const, options,
    spendContext: { agentId, runId: session.job.id, operation: 'generation', runLimitUsd: 3,
      campaignId: 'original-canary', campaignLimitUsd: 6 },
    deadlineAt: Date.now() + 240_000 };
}

describe('explicit original model stages', () => {
  it('replays persisted raw output after a crash without repurchasing it', async () => {
    const args = await input('resume');
    const generate = vi.fn(async () => output);
    await runOriginalModelStage(args, { generate });
    const job = (await getGenerationJob(args.session.agentId))!;
    const recovered = new GenerationJobSession(args.session.agentId, job);
    // Paid output remains usable even if this worker has no time for another provider call.
    expect(await runOriginalModelStage({ ...args, session: recovered, deadlineAt: 0 }, { generate })).toEqual(output);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(job.checkpoints[originalModelRequestKey(args.stage, options)]).toMatchObject({ result: output });
  });

  it('checkpoints two distinct simultaneous calls independently', async () => {
    const args = await input('independent');
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    let releaseFirst!: () => void;
    const wait = new Promise<void>(resolve => { releaseFirst = resolve; });
    const generate = vi.fn(async (request: GenerateTextOptions) => {
      if (request.task === 'idea_generation') { firstStarted(); await wait; }
      return { ...output, text: request.task! };
    });
    const first = runOriginalModelStage(args, { generate });
    await started;
    await runOriginalModelStage({ ...args, stage: 'tweet_writing' }, { generate });
    releaseFirst();
    await first;
    const stored = (await getGenerationJob(args.session.agentId))!;
    expect(stored.checkpoints[originalModelRequestKey('idea_generation', options)]).toBeDefined();
    expect(stored.checkpoints[originalModelRequestKey('tweet_writing', options)]).toBeDefined();
    expect(stored.checkpoints.callHistory).toHaveLength(2);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('defers before buying a stage that cannot fit its timeout and persistence allowance', async () => {
    const args = await input('deadline');
    const generate = vi.fn(async () => output);
    await expect(runOriginalModelStage({ ...args, deadlineAt: 64_999 }, { generate, now: () => 0 })).rejects.toThrow('run_deadline');
    expect(generate).not.toHaveBeenCalled();
    expect(args.session.deferred).toBe(true);
  });

  it('persists a provider response id immediately and retains it after failure', async () => {
    const args = await input('response-id');
    const generate = vi.fn(async (request: GenerateTextOptions) => {
      await request.onResponseId!('resp-recoverable');
      expect((await getGenerationJob(args.session.agentId))!.checkpoints[`${originalModelRequestKey(args.stage, options)}:responses`]).toEqual(['resp-recoverable']);
      throw new Error('provider_pending');
    });
    await expect(runOriginalModelStage(args, { generate })).rejects.toThrow('provider_pending');
    expect(args.session.job.checkpoints[originalModelRequestKey(args.stage, options)]).toBeUndefined();
    expect(args.session.job.blocker).toBe('provider_pending');
  });

  it('pins the same job budget across stages and prevents a caller from expanding its ceiling', async () => {
    const args = await input('budget');
    const generate = vi.fn(async (_request: GenerateTextOptions) => output);
    await runOriginalModelStage({ ...args, spendContext: { ...args.spendContext, runId: 'new-allowance', runLimitUsd: 20 } }, { generate });
    expect(generate.mock.calls[0][0].spendContext).toMatchObject({
      agentId: args.session.agentId, runId: args.session.job.id, runLimitUsd: 3,
      campaignId: 'original-canary', campaignLimitUsd: 6, allocationPolicy: true,
      requestKey: originalModelRequestKey(args.stage, options),
    });
  });

  it('lets centralized provider recovery block an unknown attempt without releasing its commitment', async () => {
    const args = await input('unknown');
    const requestKey = originalModelRequestKey(args.stage, options);
    const ledger: AiSpendLedger = { version: 'account-budget-1', day: '2026-09-28', attempts: {
      unknown: { id: 'unknown', runId: args.session.job.id, requestKey, operation: 'generation',
        provider: 'openai', model: 'gpt-6-astra', reservedUsd: 0.6, observedUsd: null,
        state: 'dispatched', createdAt: new Date().toISOString(), day: '2026-09-28' },
    } };
    await mutateAiOperationalState<AiSpendLedger, void>(args.session.agentId, 'spend', () => ({ value: ledger, result: undefined }));
    // Real generateText exits at its pending-attempt check, before any provider access.
    await expect(runOriginalModelStage(args)).rejects.toThrow('provider_pending');
    const stored = (await getAiOperationalState<AiSpendLedger>(args.session.agentId, 'spend'))!;
    expect(stored).toEqual(ledger);
    expect(committedAiSpend(stored.attempts.unknown)).toBe(0.6);
  });

  it('uses recovered provider output when a crash happened before the job checkpoint', async () => {
    const args = await input('recovered');
    await mutateAiOperationalState<AiSpendLedger, void>(args.session.agentId, 'spend', () => ({ value: {
      version: 'account-budget-1', day: '2026-09-28', attempts: {
        recovered: { id: 'recovered', runId: args.session.job.id, requestKey: originalModelRequestKey(args.stage, options),
          operation: 'generation', provider: 'openai', model: 'gpt-6-astra', reservedUsd: 0.6, observedUsd: 0.2,
          state: 'settled', createdAt: new Date().toISOString(), day: '2026-09-28', recoveredResult: output },
      },
    }, result: undefined }));
    expect(await runOriginalModelStage(args)).toEqual(output);
    expect(args.session.job.checkpoints[originalModelRequestKey(args.stage, options)]).toMatchObject({ result: output });
  });

  it('invalidates only a changed request contract, not a changed worker timeout', () => {
    const original = originalModelRequestKey('idea_generation', options);
    expect(originalModelRequestKey('idea_generation', { ...options, timeoutMs: 120_000 })).toBe(original);
    for (const change of [{ prompt: 'changed' }, { maxTokens: 600 }, { temperature: 0.3 },
      { openAiReasoningEffort: 'low' as const }, { jsonSchema: { type: 'array' } },
      { modelChain: [{ provider: 'anthropic' as const, model: 'changed-model' }] }]) {
      expect(originalModelRequestKey('idea_generation', { ...options, ...change })).not.toBe(original);
    }
  });
});
