import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModelCallTrace } from '@/lib/types';

const generateText = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/ai')>(), generateText }));
import { trackedGenerate } from '@/lib/generation-v2';

describe('comparison trace preserves the planned writer branch (no provider calls)', () => {
  beforeEach(() => { generateText.mockReset(); });

  it('records an explicit repair role separately from provider routing options', async () => {
    generateText.mockResolvedValue({ text: '{}', provider: 'anthropic', model: 'claude-fable-5',
      requestedProvider: 'anthropic', requestedModel: 'claude-fable-5', providerModel: 'claude-fable-5-2026-09-04',
      inputTokens: 10, outputTokens: 10, fallbackAttempts: [] });
    const calls: GenerationModelCallTrace[] = [];
    await trackedGenerate('tweet_writing', { task: 'tweet_writing', modelStack: 'publishing_v2_fable_control',
      system: 'Test.', prompt: 'Test.', maxTokens: 100 }, calls, 'postcritic_repair');
    expect(calls[0]).toMatchObject({ plannedModelStack: 'publishing_v2_fable_control', modelCallRole: 'postcritic_repair',
      requestedModel: 'claude-fable-5', model: 'claude-fable-5', providerModel: 'claude-fable-5-2026-09-04' });
    expect(generateText.mock.calls[0][0]).not.toHaveProperty('modelCallRole');
  });

  it('retains the planned repair role when the provider attempt fails', async () => {
    generateText.mockRejectedValue(Object.assign(new Error('timeout'), { requestedProvider: 'anthropic',
      requestedModel: 'claude-fable-5', fallbackAttempts: [{ provider: 'anthropic', model: 'claude-fable-5', reason: 'timeout' }] }));
    const calls: GenerationModelCallTrace[] = [];
    await expect(trackedGenerate('tweet_writing', { task: 'tweet_writing', modelStack: 'publishing_v2_fable_control',
      system: 'Test.', prompt: 'Test.', maxTokens: 100 }, calls, 'postcritic_repair')).rejects.toThrow('timeout');
    expect(calls[0]).toMatchObject({ plannedModelStack: 'publishing_v2_fable_control', modelCallRole: 'postcritic_repair',
      requestedModel: 'claude-fable-5', succeeded: false, fallbackAttempts: [{ reason: 'timeout' }] });
  });

  it('defaults normal calls to their primary role and preserves Astra writer deadline', async () => {
    generateText.mockResolvedValue({ text: '{}', provider: 'openai', model: 'gpt-6-astra', inputTokens: 10, outputTokens: 10 });
    const calls: GenerationModelCallTrace[] = [];
    await trackedGenerate('tweet_writing', { task: 'tweet_writing', modelStack: 'publishing_v2_astra', system: 'Test.', prompt: 'Test.', maxTokens: 100 }, calls);
    expect(calls[0]).toMatchObject({ plannedModelStack: 'publishing_v2_astra', modelCallRole: 'primary' });
    expect(generateText.mock.calls[0][0].timeoutMs).toBe(120_000);
    await trackedGenerate('tweet_writing', { task: 'tweet_writing', modelStack: 'publishing_v2_gpt_control', system: 'Test.', prompt: 'Test.', maxTokens: 100 }, []);
    expect(generateText.mock.calls[1][0].timeoutMs).toBe(75_000);
  });
});
