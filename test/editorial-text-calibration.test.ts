import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: new Map<string, any>(), score: vi.fn(), view: null as any,
  baseline: { model: 'judge', promptVersion: 'old', policyVersion: 'policy' } }));
vi.mock('../lib/kv-storage', () => ({
  getAiOperationalState: async (_agent: string, key: string) => state.store.get(key),
  mutateAiOperationalState: async (_agent: string, key: string, callback: any) => {
    const next = callback(state.store.get(key)); state.store.set(key, next.value); return next.result;
  },
}));
vi.mock('../lib/editorial-review-bundle', () => ({ composeEditorialReviewBundle: () => state.view }));
vi.mock('../lib/generation-v2', () => ({ getProductionEditorialBaseline: () => state.baseline }));
vi.mock('../lib/editorial-evaluation', () => ({ scoreEditorialBatch: (...args: any[]) => state.score(...args) }));
import { editorialHash } from '../lib/editorial-contract';
import { editorialBatchRequest } from '../lib/editorial-batch';
import { getEditorialSafetyFixtures } from '../lib/editorial-safety-fixtures';
import { runTextCalibrationStage, saveTextCalibrationProjection, textCalibrationResultKey } from '../lib/editorial-text-calibration';

describe('resumable labelled-text calibration', () => {
  async function prepare() {
    const safety = getEditorialSafetyFixtures();
    const examples = Array.from({ length: 7 }, (_, index) => ({ id: `owner-${index}`, content: `Opinion ${index}`,
      label: 'approved', split: index < 4 ? 'train' : 'holdout', labelSource: 'explicit_owner_review' }));
    state.view = { evaluationViewHash: 'view', examples };
    const rows = examples.map(example => ({ example, item: { id: example.id, content: example.content, context: safety.negativeCases[0].assessmentContext } }));
    const items = [...rows.map(row => row.item), ...safety.negativeCases.map(row => ({ id: row.id, content: row.content, context: row.assessmentContext }))];
    const body = { version: 'labelled-text-calibration-1', viewHash: 'view', parentHash: 'parent', model: 'judge', rows, items,
      baselinePolicy: state.baseline, baselineInput: { agentId: '13' }, baselineRequest: {}, candidateRequest: editorialBatchRequest(items, 'judge') };
    const p = { ...body, hash: editorialHash(body) };
    await saveTextCalibrationProjection(p as any, { manifest: { hash: 'parent', agentId: '13', baseline: state.baseline } } as any);
    return p;
  }
  beforeEach(() => {
    state.store.clear(); state.score.mockReset();
    state.score.mockImplementation(async ({ items }) => ({ requestKey: editorialHash(items), result: { model: 'judge' },
      assessments: items.map((item: any) => ({ id: item.id, assessment: { editorialScore: .9 } })) }));
  });
  it('buys at most six assessments per invocation and reuses completed batches after a later failure', async () => {
    const p = await prepare();
    expect(await runTextCalibrationStage(p.hash, 'candidate')).toMatchObject({ complete: false, completedBatches: 1, totalBatches: 3 });
    state.score.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(runTextCalibrationStage(p.hash, 'candidate')).rejects.toThrow('provider_pending');
    expect(await runTextCalibrationStage(p.hash, 'candidate')).toMatchObject({ complete: false, completedBatches: 2 });
    const complete = await runTextCalibrationStage(p.hash, 'candidate');
    expect(complete.complete).toBe(true);
    expect(complete.assessments).toHaveLength(13);
    expect(state.score.mock.calls.map(([call]) => call.items.map((item: any) => item.id))).toEqual([
      p.items.slice(0, 6).map(item => item.id), p.items.slice(6, 12).map(item => item.id),
      p.items.slice(6, 12).map(item => item.id), p.items.slice(12).map(item => item.id),
    ]);
    await runTextCalibrationStage(p.hash, 'candidate');
    expect(state.score).toHaveBeenCalledTimes(4);
    expect(state.store.get(textCalibrationResultKey(p.hash, 'candidate')).batches).toHaveLength(3);
    for (const [call] of state.score.mock.calls) expect(call.spendContext).toMatchObject({ runLimitUsd: 3, campaignLimitUsd: 6, runId: 'editorial-text-calibration-2026-09-29' });
  });
  it('retains malformed paid batches without automatically buying replacements', async () => {
    const p = await prepare();
    state.score.mockResolvedValueOnce({ result: { model: 'judge', text: 'bad' }, requestKey: 'paid', assessments: null });
    expect(await runTextCalibrationStage(p.hash, 'candidate')).toMatchObject({ complete: false, assessments: null });
    expect(await runTextCalibrationStage(p.hash, 'candidate')).toMatchObject({ complete: false, assessments: null });
    expect(state.score).toHaveBeenCalledTimes(1);
    await expect(runTextCalibrationStage(p.hash, 'baseline')).rejects.toThrow('candidate_assessment_pending');
  });
  it('rejects modified frozen text before any scoring', async () => {
    const p = await prepare();
    const saved = state.store.get(`text-calibration-projection:${p.hash}`);
    saved.projection.items[0].content = 'changed';
    await expect(runTextCalibrationStage(p.hash, 'candidate')).rejects.toThrow('invalid_text_calibration_projection');
    expect(state.score).not.toHaveBeenCalled();
  });
});
