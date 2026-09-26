import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProbationRunner, probationInputBytes, probationOptions, PROBATION, PROBATION_ROUTES, PROBATION_SLOTS,
  ProbationError, verifyProbationArtifacts, verifyProbationEngine, type ProbationDependencies, type ProbationState } from '@/lib/antihunter-probation';
import { reserveAiSpendInLedger, AiBudgetError, type AiSpendLedger } from '@/lib/ai-budget';
import { AI_PRICING_VERSION, estimateAiUsageCostUsd, getAiModelPricing } from '@/lib/ai-pricing';
import { probationChildEnvironment } from '../scripts/operator-probation';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/probation-v1/', import.meta.url));
const local = (name: string) => readFile(path.join(fixtureDirectory, name));
const bundlePromise = verifyProbationArtifacts(PROBATION.artifactDirectory, local, local);
async function harness() {
  const bundle = await bundlePromise;
  let state: ProbationState | null = null;
  let ledger: AiSpendLedger = { version: 'account-budget-1', day: '2026-09-21', attempts: {} };
  let count = 0;
  const deps: ProbationDependencies = {
    verify: vi.fn(async () => bundle), runtime: vi.fn(async () => {}), budget: vi.fn(async () => ({ remainingUsd: 24 })),
    now: () => Date.parse('2026-09-21T17:30:00Z'),
    read: vi.fn(async () => structuredClone(state)), ledger: vi.fn(async () => structuredClone(ledger)),
    mutate: vi.fn(async update => {
      const next: ProbationState = structuredClone(state || { version: 1, manifestSha256: PROBATION.manifestSha256, slots: {} });
      const result = update(next); state = next; return result;
    }),
    generate: vi.fn(async options => {
      const id = `attempt-${++count}`, target = options.modelChain[0];
      const inputBytes = probationInputBytes(options.system, options.messages[0].content);
      ledger = reserveAiSpendInLedger(ledger, options.spendContext, { id, ...target, operation: options.spendContext.operation,
        runId: options.spendContext.runId, campaignId: options.spendContext.campaignId, day: '2026-09-21',
        state: 'dispatched', reservedUsd: estimateAiUsageCostUsd(target.model, inputBytes + 16384, 4000), observedUsd: null,
        createdAt: '2026-09-21T17:30:00Z', pricingVersion: AI_PRICING_VERSION, pricingRates: getAiModelPricing(target.model),
      }, '2026-09-21', 24);
      const row = bundle.cases.find(row => row.input === options.messages[0].content);
      const result = { provider: target.provider, model: target.model, providerModel: target.model,
        requestedProvider: target.provider, requestedModel: target.model, fallbackAttempts: [],
        spendAttemptId: id, text: JSON.stringify(row.expected), inputTokens: 100, outputTokens: 100, stopReason: 'end_turn' };
      ledger.attempts[id] = { ...ledger.attempts[id], state: 'settled', inputTokens: 100, outputTokens: 100,
        actualModel: target.model, observedUsd: estimateAiUsageCostUsd(target.model, 100, 100) };
      return result;
    }),
  };
  return { deps, bundle, runner: createProbationRunner(deps), getState: () => state, setState: (next: ProbationState) => { state = next; },
    getLedger: () => ledger, setLedger: (next: AiSpendLedger) => { ledger = next; } };
}

describe('frozen probation artifacts and isolation', () => {
  it('keeps the old engine frozen while validating local/published-byte fixtures without a network request', async () => {
    // The shared budget/provider engine has changed since probation-v1 was
    // frozen. Do not silently repin or authorize that historical experiment.
    await expect(verifyProbationEngine()).rejects.toMatchObject({ code: 'source_changed' });
    const bundle = await bundlePromise;
    expect(bundle.cases).toHaveLength(10);
    expect(bundle.cases.every(row => probationInputBytes(bundle.system, row.input) <= 4096)).toBe(true);
    for (const row of bundle.cases) expect(bundle.score(row.expected, JSON.stringify(row.expected)).accepted).toBe(true);
  });
  it.each(['manifest.json', 'cases.json', 'prompt.txt', 'protocol.json', 'score.mjs'])('rejects changed live %s before generation', async name => {
    await expect(verifyProbationArtifacts(PROBATION.artifactDirectory, local,
      async requested => requested === name ? Buffer.concat([await local(requested), Buffer.from(' ')]) : local(requested)))
      .rejects.toMatchObject({ code: 'artifacts_changed' });
  });
  it('overrides only the dedicated child and preserves its source environment', () => {
    const original: NodeJS.ProcessEnv = { AI_MODEL_POLICY: 'astra_all', NODE_ENV: 'test', VITEST: 'true', ANTHROPIC_API_KEY: 'private-test-key' };
    expect(probationChildEnvironment(original)).toMatchObject({ AI_MODEL_POLICY: 'standard', NODE_ENV: 'production',
      VITEST: 'false', AI_BUDGET_TEST_ENFORCE: 'true', ANTIHUNTER_PROBATION_CHILD: '1' });
    expect(original.AI_MODEL_POLICY).toBe('astra_all');
  });
  it('uses exact account5 attribution and only frozen inputs/controls in all twenty slots', async () => {
    const h = await harness();
    const result = await h.runner.run();
    expect(h.deps.generate).toHaveBeenCalledTimes(20);
    expect(PROBATION_SLOTS.slice(0, 4).map(slot => slot.id)).toEqual(['01:sonnet', '01:fable', '02:fable', '02:sonnet']);
    for (const [i, [options]] of vi.mocked(h.deps.generate).mock.calls.entries()) {
      expect(Object.keys(options).sort()).toEqual(['system', 'messages', 'modelChain', 'maxTokens', 'timeoutMs', 'spendContext'].sort());
      expect(options).toEqual(probationOptions(h.bundle, PROBATION_SLOTS[i]));
      expect(options.spendContext).toEqual({ agentId: '5', operation: 'extraction-comparison', runId: 'extraction-v1',
        runLimitUsd: 3, campaignId: 'extraction-v1', campaignLimitUsd: 3 });
    }
    expect(result).toMatchObject({ complete: true, status: 'complete-reconciled', outcome: 'dominant', headlineWinner: 'sonnet' });
    expect(result.configurations.map(c => [c.accepted, c.fieldsCorrect, c.schemaValid, c.reviewCorrect])).toEqual([[10, 60, 10, 10], [10, 60, 10, 10]]);
    await h.runner.run();
    expect(h.deps.generate).toHaveBeenCalledTimes(20);
  });
  it('accounts for JSON field names, escaping and UTF8 in the input limit', async () => {
    const h = await harness();
    expect(probationInputBytes('a', '☃\n"')).toBe(Buffer.byteLength(JSON.stringify({ system: 'a', messages: [{ role: 'user', content: '☃\n"' }] }), 'utf8'));
    expect(() => probationOptions({ ...h.bundle, system: 'x'.repeat(4096) }, PROBATION_SLOTS[0])).toThrow('input_limit');
  });
});

describe('durable claims, budget and crash handling', () => {
  it('admits only one concurrent runner and never repeats a slot', async () => {
    const h = await harness();
    const outcomes = await Promise.allSettled([h.runner.run(), h.runner.run()]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(h.deps.generate).toHaveBeenCalledTimes(20);
    expect(Object.keys(h.getState().slots)).toHaveLength(20);
  });
  it('persists a claim before generation and fails closed after a receipt write crash', async () => {
    const h = await harness(), generate = h.deps.generate;
    h.deps.generate = vi.fn(async options => {
      expect(h.getState().slots['01:sonnet'].state).toBe('claimed');
      return generate(options);
    });
    const mutate = h.deps.mutate;
    // Use a separate wrapper so the first call retains the original implementation.
    let writes = 0;
    h.deps.mutate = async update => { if (++writes === 2) throw new Error('private storage failure'); return mutate(update); };
    await expect(h.runner.run()).rejects.toThrow();
    expect(h.deps.generate).toHaveBeenCalledOnce();
    const report = await h.runner.report();
    expect(report.rows[0].status).toBe('uncertain');
    expect(report.complete).toBe(false);
    expect(report.configurations[0].estimatedCostUsd).toBeNull();
    await expect(h.runner.run()).rejects.toMatchObject({ code: 'run_halted' });
    expect(h.deps.generate).toHaveBeenCalledOnce();
  });
  it('stops if artifacts change after the durable claim and before a paid request', async () => {
    const h = await harness();
    vi.mocked(h.deps.verify).mockResolvedValueOnce(h.bundle).mockRejectedValueOnce(new ProbationError('artifacts_changed')).mockResolvedValue(h.bundle);
    const report = await h.runner.run();
    expect(h.deps.generate).not.toHaveBeenCalled();
    expect(report.rows[0]).toMatchObject({ status: 'blocked', attempted: false, error: 'artifacts_changed' });
  });
  it('stops before admission if daily budget cannot reserve the next call', async () => {
    const h = await harness();
    vi.mocked(h.deps.budget).mockResolvedValue({ remainingUsd: 0.01 });
    const report = await h.runner.run();
    expect(h.deps.generate).not.toHaveBeenCalled();
    expect(report.rows[0]).toMatchObject({ status: 'blocked', attempted: false, error: 'budget_exhausted' });
  });
  it('stops at the fixed campaign cap as prior settled calls consume capacity', async () => {
    const h = await harness(), normal = h.deps.generate;
    h.deps.generate = vi.fn(async options => {
      const result = await normal(options), ledger = h.getLedger();
      result.inputTokens = 20000; result.outputTokens = 4000;
      Object.assign(ledger.attempts[result.spendAttemptId], { inputTokens: 20000, outputTokens: 4000,
        observedUsd: estimateAiUsageCostUsd(result.model, 20000, 4000) });
      return result;
    });
    const report = await h.runner.run();
    expect(report.complete).toBe(false);
    expect(report.rows.some(row => row.error === 'budget_exhausted' && row.attempted === false)).toBe(true);
    expect(Object.values(h.getLedger().attempts).reduce((sum, a) => sum + (a.observedUsd ?? a.reservedUsd), 0)).toBeLessThanOrEqual(3);
    expect(vi.mocked(h.deps.generate).mock.calls.length).toBeLessThan(20);
  });
  it('preserves an unknown reservation and never publishes zero cost after crash', async () => {
    const h = await harness(), normal = h.deps.generate;
    h.deps.generate = vi.fn(async options => {
      const result = await normal(options);
      Object.assign(h.getLedger().attempts[result.spendAttemptId], { state: 'reserved', observedUsd: null });
      throw new Error('Secret diagnostic must never appear');
    });
    const report = await h.runner.run();
    expect(report.rows[0]).toMatchObject({ status: 'failed', attempted: null, estimatedCostUsd: null, error: 'provider_error' });
    expect(report.configurations[0].estimatedCostUsd).toBeNull();
    expect(report.configurations[0].unresolvedReservationUsd).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain('Secret diagnostic');
    await expect(h.runner.run()).rejects.toMatchObject({ code: 'run_halted' });
  });
  it('records a shared-wrapper incomplete exception with unavailable raw output and exact settled charges', async () => {
    const h = await harness(), normal = h.deps.generate;
    h.deps.generate = vi.fn(async options => {
      await normal(options);
      throw Object.assign(new Error('Private provider message'), { fallbackAttempts: [{ reason: 'incomplete' }] });
    });
    const report = await h.runner.run();
    expect(report.rows[0]).toMatchObject({ status: 'failed', attempted: true, output: null, returnedModel: null, error: 'incomplete' });
    expect(report.rows[0].estimatedCostUsd).toBeGreaterThan(0);
    expect(report.headlineWinner).toBeNull();
  });
  it.each(['missing_usage', 'fractional_usage', 'zero_output', 'missing_model', 'wrong_model', 'fallback'] as const)('stops on %s without using requested model as identity evidence', async variation => {
    const h = await harness(), normal = h.deps.generate;
    h.deps.generate = vi.fn(async options => {
      const result = await normal(options);
      if (variation === 'missing_usage') {
        result.inputTokens = null;
        Object.assign(h.getLedger().attempts[result.spendAttemptId], { state: 'dispatched', observedUsd: null });
      } else if (variation === 'fractional_usage' || variation === 'zero_output') {
        if (variation === 'fractional_usage') result.inputTokens = 0.5;
        else result.outputTokens = 0;
        Object.assign(h.getLedger().attempts[result.spendAttemptId], { inputTokens: result.inputTokens,
          outputTokens: result.outputTokens, observedUsd: estimateAiUsageCostUsd(result.model, result.inputTokens, result.outputTokens) });
      }
      else if (variation === 'missing_model') result.providerModel = null;
      else if (variation === 'wrong_model') result.providerModel = 'claude-wrong';
      else result.fallbackAttempts = [{ model: 'other' } as any];
      return result;
    });
    const report = await h.runner.run();
    expect(h.deps.generate).toHaveBeenCalledOnce();
    expect(report).toMatchObject({ complete: false, headlineWinner: null });
    expect(report.configurations[0].accepted).toBe(0);
    if (['fractional_usage', 'zero_output', 'missing_usage'].includes(variation)) {
      expect(report.configurations[0].estimatedCostUsd).toBeNull();
      expect(report.configurations[0].unresolvedReservationUsd).toBeGreaterThan(0);
      expect(report.rows[0].spending[0].accountingValidity).toBe('unresolved');
    }
  });
  it('refuses orphan or foreign-attribution attempts instead of borrowing their budget', async () => {
    const h = await harness();
    h.getLedger().attempts.foreign = { id: 'foreign', runId: 'extraction-v1', campaignId: 'other', operation: 'other' } as any;
    await expect(h.runner.preflight()).rejects.toMatchObject({ code: 'ledger_mismatch' });
    expect(h.deps.generate).not.toHaveBeenCalled();
  });
});
