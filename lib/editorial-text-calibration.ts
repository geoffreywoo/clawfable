import { generateText } from './ai';
import { cachedAiValue } from './ai-value-cache';
import { editorialBatchRequest, type EditorialBatchItem } from './editorial-batch';
import { editorialHash } from './editorial-contract';
import { scoreEditorialBatch } from './editorial-evaluation';
import { getProductionEditorialBaseline } from './generation-v2';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import { composeEditorialReviewBundle, type EditorialReviewBundle } from './editorial-review-bundle';
import { getEditorialSafetyFixtures } from './editorial-safety-fixtures';

export interface TextCalibrationProjection {
  version: 'labelled-text-calibration-1';
  hash: string;
  viewHash: string;
  parentHash: string;
  model: string;
  items: EditorialBatchItem[];
  rows: Array<{ example: { id: string; content: string; split: string; label: string }; item: EditorialBatchItem }>;
  baselinePolicy: ReturnType<typeof getProductionEditorialBaseline>;
  baselineInput: Parameters<typeof getProductionEditorialBaseline>[0];
  baselineRequest: Parameters<typeof generateText>[0];
  candidateRequest: ReturnType<typeof editorialBatchRequest>;
  [key: string]: unknown;
}
const namespace = (hash: string) => `text-calibration-projection:${hash}`;
export const textCalibrationResultKey = (hash: string, stage: 'candidate' | 'baseline') => `text-calibration-result:${hash}:${stage}`;

export function validateTextCalibrationProjection(projection: TextCalibrationProjection, bundle: EditorialReviewBundle) {
  const { hash, ...body } = projection;
  const view = composeEditorialReviewBundle(bundle);
  const required = view.examples.filter(e => e.labelSource !== 'owner_self_written');
  if (projection.version !== 'labelled-text-calibration-1' || editorialHash(body) !== hash
    || projection.parentHash !== bundle.manifest.hash || projection.viewHash !== view.evaluationViewHash
    || projection.baselineInput.agentId !== '13' || bundle.manifest.agentId !== '13'
    || projection.model !== bundle.manifest.baseline.model
    || editorialHash(projection.baselinePolicy) !== editorialHash(bundle.manifest.baseline)
    || projection.rows.length !== required.length || new Set(projection.rows.map(row => row.example.id)).size !== required.length
    || required.some(e => !projection.rows.some(row => row.example.id === e.id && row.example.content === e.content
      && row.example.label === e.label && row.example.split === e.split && row.item.id === e.id && row.item.content === e.content)))
    throw new Error('invalid_text_calibration_projection');
  const safety = getEditorialSafetyFixtures();
  const expected = [...projection.rows.map(row => row.item), ...safety.negativeCases.map(row => ({ id: row.id, content: row.content, context: row.assessmentContext }))];
  if (projection.items.length !== expected.length || new Set(projection.items.map(item => item.id)).size !== expected.length
    || expected.some(item => !projection.items.some(actual => editorialHash(actual) === editorialHash(item)))
    || editorialHash(editorialBatchRequest(projection.items, projection.model)) !== editorialHash(projection.candidateRequest))
    throw new Error('text_calibration_request_mismatch');
}

export async function saveTextCalibrationProjection(projection: TextCalibrationProjection, bundle: EditorialReviewBundle) {
  validateTextCalibrationProjection(projection, bundle);
  return mutateAiOperationalState<{ projection: TextCalibrationProjection; bundle: EditorialReviewBundle }, void>('13', namespace(projection.hash), old => {
    if (old && editorialHash(old.projection) !== editorialHash(projection)) throw new Error('frozen_text_calibration_changed');
    return { value: old || { projection, bundle }, result: undefined };
  });
}

/** Authenticated operator execution on the host with the provider credential.
 * Independent paid stages are cached before this receipt is saved. No queue,
 * policy activation, source renewal, or canary mutation is possible here.
 */
export async function runTextCalibrationStage(hash: string, stage: 'candidate' | 'baseline') {
  const stored = await getAiOperationalState<{ projection: TextCalibrationProjection; bundle: EditorialReviewBundle }>('13', namespace(hash));
  if (!stored) throw new Error('text_calibration_projection_missing');
  const { projection: p, bundle } = stored;
  validateTextCalibrationProjection(p, bundle);
  if (editorialHash(getProductionEditorialBaseline(p.baselineInput)) !== editorialHash(p.baselinePolicy)) throw new Error('active_policy_changed');
  const key = textCalibrationResultKey(hash, stage);
  const existing = await getAiOperationalState<any>('13', key);
  if (existing) return existing;
  const spendContext = { agentId: '13', operation: 'quality-evaluation', runId: 'editorial-text-calibration-2026-09-29',
    runLimitUsd: 3, campaignId: 'reliable-originals-2026-09-26', campaignLimitUsd: 6, evaluation: true };
  let value: any;
  if (stage === 'candidate') value = await scoreEditorialBatch({ agentId: '13', items: p.items, model: p.model, spendContext });
  else {
    const candidate = await getAiOperationalState<any>('13', textCalibrationResultKey(hash, 'candidate'));
    if (!candidate?.assessments) throw new Error('candidate_assessment_pending');
    const options = { ...p.baselineRequest, maxTokens: 8192, timeoutMs: 120_000 };
    const requestKey = editorialHash(['labelled-text-legacy-bound-1', p.model, options]);
    const result = await cachedAiValue('13', 'editorial-text-legacy-bound', requestKey,
      () => generateText({ ...options, spendContext: { ...spendContext, requestKey } }));
    value = { result, requestKey };
  }
  await mutateAiOperationalState<any, void>('13', key, old => ({ value: old || value, result: undefined }));
  return value;
}
