import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({ create: vi.fn(), reserve: vi.fn(), update: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.create }; } }));
vi.mock('@/lib/ai-budget', async () => ({ ...await vi.importActual<typeof import('@/lib/ai-budget')>('@/lib/ai-budget'),
  reserveAiAttempt: mocks.reserve, updateAiAttempt: mocks.update }));
import { generateText } from '@/lib/ai';
import { probationOptions, PROBATION, PROBATION_SLOTS, verifyProbationArtifacts } from '@/lib/antihunter-probation';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('sends the actual shared-client wire controls through a mock SDK with account5 admission and no fallback', async () => {
  vi.stubEnv('AI_MODEL_POLICY', 'standard'); vi.stubEnv('AI_BUDGET_TEST_ENFORCE', 'true');
  const local = (name: string) => readFile(path.join(fileURLToPath(new URL('./fixtures/probation-v1/', import.meta.url)), name));
  const bundle = await verifyProbationArtifacts(PROBATION.artifactDirectory, local, local);
  mocks.reserve.mockImplementation(async context => ({ context, id: 'reserved', day: '2026-09-21' }));
  mocks.update.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async request => ({ model: request.model, stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 100, output_tokens: 2 } }));
  for (const slot of PROBATION_SLOTS.slice(0, 2)) {
    const result = await generateText(probationOptions(bundle, slot));
    expect(result.requestedModel).toBe(result.providerModel);
    expect(result.fallbackAttempts).toEqual([]);
  }
  expect(mocks.create).toHaveBeenCalledTimes(2);
  for (const [request, config] of mocks.create.mock.calls) {
    expect(Object.keys(request).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect(request).toMatchObject({ max_tokens: 4000, system: bundle.system, messages: [{ role: 'user', content: bundle.cases[0].input }] });
    expect(config.maxRetries).toBe(0);
    expect(config.signal).toBeInstanceOf(AbortSignal);
  }
  expect(mocks.reserve).toHaveBeenCalledTimes(2);
  for (const [context, target, bytes, maxTokens] of mocks.reserve.mock.calls) {
    expect(context).toEqual({ agentId: '5', operation: 'extraction-comparison', runId: 'extraction-v1', runLimitUsd: 3,
      campaignId: 'extraction-v1', campaignLimitUsd: 3 });
    expect(target.provider).toBe('anthropic'); expect(bytes).toBeLessThanOrEqual(4096); expect(maxTokens).toBe(4000);
  }
});
