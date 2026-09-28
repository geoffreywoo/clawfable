import { generateText, getModelChainForTask } from './ai';
import { cachedAiValue } from './ai-value-cache';
import { aiSpendContext, type AiSpendLedger } from './ai-budget';
import { CANDIDATE_EDITORIAL_VERSION, EDITORIAL_ASSESSMENT_SCHEMA, editorialPrompt, editorialHash, parseEditorialAssessment, deterministicEditorialBlockers, type EditorialContext } from './editorial-contract';
import { getEditorialManifest, getFrozenOwnerReview, resolveFrozenOwnerReview, type EditorialEvaluationRow } from './editorial-calibration';
import { assessExistingDraftUnderProductionPolicy, type GenerateTweetBatchV2Input } from './generation-v2';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import { getPublishingV2QualityPolicyVersion } from './publishing-quality-policy';

export async function writeEditorialEvaluationVariants(input: { agentId: string; runId: string; publicMove: string; context: EditorialContext; model: string }) {
  const prompt = editorialPrompt('writing', input.context);
  const key = editorialHash([prompt, input.publicMove, input.model]);
  return cachedAiValue(input.agentId, 'editorial-candidate-writing', key, () => generateText({
    task: 'tweet_writing', modelChain: [{ provider: 'openai', model: input.model }], maxTokens: 1600, timeoutMs: 90000,
    spendContext: { ...aiSpendContext(input.agentId, 'quality-evaluation', input.runId, 3), evaluation: true, requestKey: key },
    system: prompt.system, prompt: JSON.stringify({ context: prompt.context, publicMove: input.publicMove }),
    jsonSchema: { type: 'object', additionalProperties: false, required: ['drafts'], properties: {
      drafts: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    } },
  }));
}

/** One batch assessment, with the same context object used by the candidate writer and idea assessor. */
export async function evaluateEditorialVariants(input: { agentId: string; runId: string; stage: 'idea' | 'final'; context: EditorialContext;
  variants: Array<{ id: string; content: string }>; model: string }) {
  const prompt = editorialPrompt(input.stage, input.context);
  const key = editorialHash([prompt, input.variants, input.model]);
  return cachedAiValue(input.agentId, 'editorial-candidate-evaluation', key, async () => {
    const result = await generateText({
      task: 'copy_judgment', modelChain: [{ provider: 'openai', model: input.model }], maxTokens: 2200, timeoutMs: 90000,
      spendContext: { ...aiSpendContext(input.agentId, 'quality-evaluation', input.runId, 3), evaluation: true, requestKey: key },
      system: prompt.system, prompt: JSON.stringify({ context: prompt.context, candidates: input.variants }),
      jsonSchema: { type: 'object', additionalProperties: false, required: ['assessments'], properties: {
        assessments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'assessment'],
          properties: { id: { type: 'string' }, assessment: EDITORIAL_ASSESSMENT_SCHEMA } } },
      } },
    });
    // Save malformed paid output too. It is pending assessment, never a taste rejection.
    let parsed: unknown;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const rows = (parsed as { assessments?: Array<{ id: string; assessment: unknown }> })?.assessments;
    const complete = Array.isArray(rows) && rows.length === input.variants.length
      && input.variants.every(v => rows.filter(r => r.id === v.id).length === 1);
    return { result, contextHash: editorialHash(input.context), contractVersion: CANDIDATE_EDITORIAL_VERSION,
      assessments: input.variants.map(v => ({ id: v.id, assessment: complete ? parseEditorialAssessment(rows.find(r => r.id === v.id)?.assessment) : null })) };
  });
}

/** Never runs generation or queues a post. Both paid assessments are recoverable independently. */
export async function rescoreFrozenEditorialExample(input: GenerateTweetBatchV2Input, manifestId: string, exampleId: string,
  artifact: Parameters<typeof assessExistingDraftUnderProductionPolicy>[1], context: EditorialContext) {
  const manifest = await getEditorialManifest(input.agentId, manifestId);
  const frozen = manifest?.examples.find(e => e.id === exampleId);
  const example = frozen && manifest ? resolveFrozenOwnerReview(frozen, manifest.hash, await getFrozenOwnerReview(input.agentId, manifest.hash, exampleId)) : undefined;
  if (!manifest || !example || example.content !== artifact.draft.content) throw new Error('frozen_example_required');
  if (!example.label) throw new Error('owner_review_pending');
  const model = getModelChainForTask('copy_judgment', input.modelStack)[0]?.model;
  if (model !== manifest.baseline.model || getPublishingV2QualityPolicyVersion('original', 'geoffwoo') !== manifest.baseline.policyVersion)
    throw new Error('active_policy_changed');
  const assessmentInputHash = editorialHash([artifact, context, input.voiceProfile, input.learnings, input.modelStack, manifest.baseline]);
  await mutateAiOperationalState<{ hash: string }, void>(input.agentId, `editorial-context:${manifest.hash}:${exampleId}`, old => {
    if (old && old.hash !== assessmentInputHash) throw new Error('frozen_assessment_context_changed');
    return { value: old || { hash: assessmentInputHash }, result: undefined };
  });
  const existing = await getEditorialEvaluationRow(input.agentId, manifest.hash, exampleId);
  if (existing) return existing;
  const runId = `editorial-evaluation:${manifest.hash}:${exampleId}`;
  const spendContext = { ...aiSpendContext(input.agentId, 'quality-evaluation', runId, 3), evaluation: true };
  const baseline = await cachedAiValue(input.agentId, 'editorial-baseline-evaluation', [manifest.hash, exampleId, artifact],
    () => assessExistingDraftUnderProductionPolicy({ ...input, spendContext }, artifact));
  if (baseline.draft.rejectionCodes.some(code => ['copy_judge_unavailable', 'malformed_copy_judgment'].includes(code))) return { disposition: 'pending_assessment' as const };
  if (baseline.promptVersion !== manifest.baseline.promptVersion || (baseline.draft.judgeModel && baseline.draft.judgeModel !== model)) throw new Error('active_judge_changed');
  const candidate = await evaluateEditorialVariants({ agentId: input.agentId, runId, stage: 'final', context,
    variants: [{ id: exampleId, content: example.content }], model });
  const assessment = candidate.assessments[0]?.assessment;
  if (!assessment) return { disposition: 'pending_assessment' as const };
  const ledger = await getAiOperationalState<AiSpendLedger>(input.agentId, 'spend');
  const row: EditorialEvaluationRow = { id: exampleId, manifestHash: manifest.hash, contentHash: example.contentHash,
    candidateVersion: CANDIDATE_EDITORIAL_VERSION, model: candidate.result.model,
    baseline: { ...manifest.baseline, accepted: baseline.accepted, rejectionCodes: baseline.draft.rejectionCodes }, candidate: assessment,
    deterministicBlockers: deterministicEditorialBlockers(baseline.draft.rejectionCodes),
    spendAttemptIds: Object.values(ledger?.attempts || {}).filter(a => a.runId === runId).map(a => a.id) };
  await mutateAiOperationalState<EditorialEvaluationRow, void>(input.agentId, `editorial-score:${manifest.hash}:${exampleId}`,
    old => ({ value: old || row, result: undefined }));
  return row;
}
export const getEditorialEvaluationRow = (agentId: string, hash: string, id: string) => getAiOperationalState<EditorialEvaluationRow>(agentId, `editorial-score:${hash}:${id}`);
