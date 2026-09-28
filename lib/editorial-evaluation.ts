import { generateText, getModelChainForTask } from './ai';
import { cachedAiValue } from './ai-value-cache';
import { type AiSpendContext, type AiSpendLedger } from './ai-budget';
import { CANDIDATE_EDITORIAL_VERSION, EDITORIAL_ASSESSMENT_SCHEMA, editorialPrompt, editorialHash, parseEditorialAssessment, deterministicEditorialBlockers, type EditorialContext } from './editorial-contract';
import { getEditorialManifest, getFrozenOwnerReview, resolveFrozenOwnerReview, type EditorialEvaluationRow } from './editorial-calibration';
import { assessExistingDraftUnderProductionPolicy, type GenerateTweetBatchV2Input } from './generation-v2';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import { getPublishingV2QualityPolicyVersion } from './publishing-quality-policy';
import { EDITORIAL_EVALUATOR_VERSION as EVALUATOR_VERSION, validateEditorialSupplement, type EditorialHoldoutSupplement } from './editorial-review-bundle';

/** Evaluation shares the caller's bounded run and campaign across every row and resume. */
export function editorialEvaluationSpendContext(agentId: string, context?: AiSpendContext): AiSpendContext {
  if (!context?.evaluation || context.agentId !== agentId || !context.runId?.trim()
    || !context.campaignId?.trim() || !Number.isFinite(context.campaignLimitUsd) || context.campaignLimitUsd! <= 0
    || !Number.isFinite(context.runLimitUsd) || context.runLimitUsd! <= 0) throw new Error('bounded_evaluation_budget_required');
  return { ...context, operation: 'quality-evaluation', runLimitUsd: Math.min(context.runLimitUsd!, 3), evaluation: true };
}

export async function writeEditorialEvaluationVariants(input: { agentId: string; publicMove: string; context: EditorialContext; model: string; spendContext: AiSpendContext }) {
  const spendContext = editorialEvaluationSpendContext(input.agentId, input.spendContext);
  const prompt = editorialPrompt('writing', input.context);
  const key = editorialHash([prompt, input.publicMove, input.model]);
  return cachedAiValue(input.agentId, 'editorial-candidate-writing', key, () => generateText({
    task: 'tweet_writing', modelChain: [{ provider: 'openai', model: input.model }], maxTokens: 1600, timeoutMs: 90000,
    spendContext: { ...spendContext, requestKey: key },
    system: prompt.system, prompt: JSON.stringify({ context: prompt.context, publicMove: input.publicMove }),
    jsonSchema: { type: 'object', additionalProperties: false, required: ['drafts'], properties: {
      drafts: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    } },
  }));
}

/** One batch assessment, with the same context object used by the candidate writer and idea assessor. */
export async function evaluateEditorialVariants(input: { agentId: string; stage: 'idea' | 'final'; context: EditorialContext;
  variants: Array<{ id: string; content: string }>; model: string; spendContext: AiSpendContext }) {
  const spendContext = editorialEvaluationSpendContext(input.agentId, input.spendContext);
  const prompt = editorialPrompt(input.stage, input.context);
  const key = editorialHash([prompt, input.variants, input.model]);
  return cachedAiValue(input.agentId, 'editorial-candidate-evaluation', key, async () => {
    const result = await generateText({
      task: 'copy_judgment', modelChain: [{ provider: 'openai', model: input.model }], maxTokens: 2200, timeoutMs: 90000,
      spendContext: { ...spendContext, requestKey: key },
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
    return { result, requestKey: key, contextHash: editorialHash(input.context), contractVersion: CANDIDATE_EDITORIAL_VERSION,
      assessments: input.variants.map(v => ({ id: v.id, assessment: complete ? parseEditorialAssessment(rows.find(r => r.id === v.id)?.assessment) : null })) };
  });
}

/** Never runs generation or queues a post. Both paid assessments are recoverable independently. */
export async function rescoreFrozenEditorialExample(input: GenerateTweetBatchV2Input, manifestId: string, exampleId: string,
  artifact: Parameters<typeof assessExistingDraftUnderProductionPolicy>[1], context: EditorialContext, supplementId?: string) {
  const budget = editorialEvaluationSpendContext(input.agentId, input.spendContext);
  const manifest = await getEditorialManifest(input.agentId, manifestId);
  if (!manifest) throw new Error('frozen_example_required');
  const supplement = supplementId ? await getAiOperationalState<EditorialHoldoutSupplement>(input.agentId, `editorial-supplement:${supplementId}`) : null;
  if (supplementId && !supplement) throw new Error('frozen_supplement_required');
  if (supplement) validateEditorialSupplement(manifest, supplement);
  const origin = supplement || manifest;
  const frozen = origin.examples.find(e => e.id === exampleId);
  if (supplement && supplement.examples.find(e => e.id === exampleId)?.contextHash !== editorialHash(context)) throw new Error('frozen_assessment_context_changed');
  if (supplement) {
    const frozenArtifact = (frozen as unknown as { artifact?: unknown })?.artifact;
    const suppliedArtifact = { draft: artifact.draft, idea: artifact.idea, brief: artifact.brief, documents: artifact.documents };
    if (!frozenArtifact || editorialHash(frozenArtifact) !== editorialHash(suppliedArtifact)) throw new Error('frozen_artifact_changed');
  }
  const example = frozen ? resolveFrozenOwnerReview(frozen, origin.hash, await getFrozenOwnerReview(input.agentId, origin.hash, exampleId)) : undefined;
  if (!manifest || !example || example.content !== artifact.draft.content) throw new Error('frozen_example_required');
  if (!example.label) throw new Error('owner_review_pending');
  const originalContext = artifact.originalEditorialContext || input.originalEditorialContext
    || (artifact.brief as { editorialContext?: EditorialContext } | null)?.editorialContext;
  if (originalContext) {
    const sharedFields: Array<keyof EditorialContext> = ['contentMode', 'ownerGuidance', 'supportedFacts', 'unresolvedClaims', 'voiceExamples', 'previousPremises'];
    if (editorialHash(sharedFields.map(key => originalContext[key])) !== editorialHash(sharedFields.map(key => context[key])))
      throw new Error('editorial_policy_context_mismatch');
  }
  const model = getModelChainForTask('copy_judgment', input.modelStack)[0]?.model;
  if (model !== manifest.baseline.model || getPublishingV2QualityPolicyVersion('original', 'geoffwoo') !== manifest.baseline.policyVersion)
    throw new Error('active_policy_changed');
  // Bind every behavior-bearing input; transport/callbacks and spending are not editorial evidence.
  const inputFields: Array<keyof GenerateTweetBatchV2Input> = ['agentId', 'requestedTopic', 'voiceProfile', 'analysis', 'learnings',
    'style', 'recentPosts', 'allTweets', 'memory', 'signals', 'trending', 'modelStack', 'generationPolicy',
    'originalEditorialContext', 'triggerId', 'idempotencyKey', 'parentIdeaId', 'parentDraftId', 'entitlement', 'allowQualityRetry'];
  const assessmentInputHash = editorialHash([EVALUATOR_VERSION, artifact, context, inputFields.map(key => [key, input[key]]), manifest.baseline]);
  await mutateAiOperationalState<{ hash: string }, void>(input.agentId, `editorial-context:${EVALUATOR_VERSION}:${origin.hash}:${exampleId}`, old => {
    if (old && old.hash !== assessmentInputHash) throw new Error('frozen_assessment_context_changed');
    return { value: old || { hash: assessmentInputHash }, result: undefined };
  });
  const existing = await getEditorialEvaluationRow(input.agentId, origin.hash, exampleId);
  if (existing) return existing;
  const requestKey = `editorial-evaluation:${EVALUATOR_VERSION}:${origin.hash}:${exampleId}`;
  const spendContext = { ...budget, requestKey };
  const baseline = await cachedAiValue(input.agentId, 'editorial-baseline-evaluation-durable-1', [origin.hash, exampleId, assessmentInputHash],
    () => assessExistingDraftUnderProductionPolicy({ ...input, spendContext }, artifact));
  if (baseline.draft.status === 'pending_assessment' || baseline.draft.rejectionCodes.some(code =>
    ['copy_judge_unavailable', 'malformed_copy_judgment', 'copy_judgment_failed'].includes(code))) return { disposition: 'pending_assessment' as const };
  if (baseline.promptVersion !== manifest.baseline.promptVersion || (baseline.draft.judgeModel && baseline.draft.judgeModel !== model)) throw new Error('active_judge_changed');
  const candidate = await evaluateEditorialVariants({ agentId: input.agentId, spendContext, stage: 'final', context,
    variants: [{ id: exampleId, content: example.content }], model });
  const assessment = candidate.assessments[0]?.assessment;
  if (!assessment) return { disposition: 'pending_assessment' as const };
  const ledger = await getAiOperationalState<AiSpendLedger>(input.agentId, 'spend');
  const row: EditorialEvaluationRow & { contextHash: string; evaluatorVersion: string } = { id: exampleId, manifestHash: origin.hash, contentHash: example.contentHash,
    contextHash: editorialHash(context), evaluatorVersion: EVALUATOR_VERSION,
    candidateVersion: CANDIDATE_EDITORIAL_VERSION, model: candidate.result.model,
    baseline: { ...manifest.baseline, accepted: baseline.accepted, rejectionCodes: baseline.draft.rejectionCodes }, candidate: assessment,
    deterministicBlockers: deterministicEditorialBlockers(baseline.draft.rejectionCodes),
    spendAttemptIds: Object.values(ledger?.attempts || {}).filter(a => a.requestKey === candidate.requestKey || a.requestKey?.startsWith(`${requestKey}:`)).map(a => a.id) };
  await mutateAiOperationalState<EditorialEvaluationRow, void>(input.agentId, `editorial-score:${EVALUATOR_VERSION}:${origin.hash}:${exampleId}`,
    old => ({ value: old || row, result: undefined }));
  return row;
}
export const getEditorialEvaluationRow = (agentId: string, hash: string, id: string) => getAiOperationalState<EditorialEvaluationRow>(agentId, `editorial-score:${EVALUATOR_VERSION}:${hash}:${id}`);
