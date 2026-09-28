import type { EditorialBaseline } from './editorial-calibration';
import { REQUIRED_EDITORIAL_SAFETY_CASES } from './editorial-calibration';
import { editorialHash, type EditorialContext } from './editorial-contract';
import { composeEditorialReviewBundle, type EditorialReviewBundle } from './editorial-review-bundle';
import type { assessExistingDraftUnderProductionPolicy, GenerateTweetBatchV2Input } from './generation-v2';
import { ORIGINAL_EDITORIAL_CONTEXT_VERSION, type OriginalEditorialContext } from './original-editorial-context';
import { isCurrentSourceEvidence } from './source-validity';

export const EDITORIAL_READINESS_VERSION = 'editorial-evaluation-readiness-1';
export interface EditorialReadinessEntry {
  id: string;
  input: GenerateTweetBatchV2Input;
  artifact: Parameters<typeof assessExistingDraftUnderProductionPolicy>[1];
  context: EditorialContext;
}
export interface EditorialSafetyInput {
  case: typeof REQUIRED_EDITORIAL_SAFETY_CASES[number];
  id: string;
  content: string;
  contentHash: string;
  context: EditorialContext;
  contextHash: string;
}
export interface EditorialEvaluationQuote {
  quotedInputHash: string;
  remainingUsd: number;
  maximumCommitmentUsd: number;
}
const sharedFields: Array<keyof EditorialContext> = ['contentMode', 'ownerGuidance', 'supportedFacts', 'unresolvedClaims', 'voiceExamples', 'previousPremises'];
const behaviorFields: Array<keyof GenerateTweetBatchV2Input> = ['agentId', 'requestedTopic', 'voiceProfile', 'analysis', 'learnings',
  'style', 'recentPosts', 'allTweets', 'memory', 'signals', 'trending', 'modelStack', 'generationPolicy',
  'originalEditorialContext', 'triggerId', 'idempotencyKey', 'parentIdeaId', 'parentDraftId', 'entitlement', 'allowQualityRetry'];
const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const validContext = (value: EditorialContext) => value && ['opinion', 'observation', 'prediction', 'factual_claim'].includes(value.contentMode)
  && sharedFields.slice(1).every(key => Array.isArray(value[key]) && (value[key] as string[]).every(text => typeof text === 'string'));

/** The same editorial input identity is usable at preparation and immediately before scoring. */
export function editorialReadinessInputHash(entry: EditorialReadinessEntry) {
  return editorialHash([entry.id, entry.artifact, entry.context, behaviorFields.map(key => [key, entry.input?.[key]])]);
}

/** Availability/consistency check only. A parent manifest did not freeze context;
 * retained parent artifacts are identified honestly, never certified as pre-label snapshots.
 * No KV access, context locks, score writes, model calls, or publication authority.
 */
export function inspectEditorialEvaluationReadiness(bundle: EditorialReviewBundle, entries: EditorialReadinessEntry[], options: {
  now?: number;
  safetyCases?: EditorialSafetyInput[];
  budgetQuote?: EditorialEvaluationQuote;
  activeBaseline?: EditorialBaseline;
} = {}) {
  const view = composeEditorialReviewBundle(bundle), now = options.now ?? Date.now();
  const required = view.examples.filter(example => example.labelSource !== 'owner_self_written');
  const requiredIds = new Set(required.map(example => example.id));
  const blockers: string[] = [];
  if (entries.some(entry => !requiredIds.has(entry.id))) blockers.push('unexpected_assessment_input');
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) blockers.push('duplicate_assessment_input');
  if (options.activeBaseline && editorialHash(options.activeBaseline) !== editorialHash(bundle.manifest.baseline)) blockers.push('active_policy_changed');
  const rows = required.map(example => {
    const entry = entries.find(candidate => candidate.id === example.id);
    const frozen = bundle.supplements?.flatMap(s => s.examples).find(candidate => candidate.id === example.id);
    const rowBlockers: string[] = [];
    if (!example.label) rowBlockers.push('owner_review_pending');
    if (!entry?.artifact) rowBlockers.push('missing_artifact');
    if (entry?.artifact) {
      const { artifact, context, input } = entry;
      if (input?.agentId !== bundle.manifest.agentId || artifact.draft?.content !== example.content
        || (example.draftId && artifact.draft?.id !== example.draftId) || !artifact.idea
        || artifact.draft?.ideaId !== artifact.idea.id) rowBlockers.push('artifact_identity_mismatch');
      if (!validContext(context)) rowBlockers.push('missing_evaluation_context');
      if (frozen) {
        if (!validContext(context) || frozen.contextHash !== editorialHash(context)) rowBlockers.push('frozen_context_mismatch');
        const rawArtifact = { draft: artifact.draft, idea: artifact.idea, brief: artifact.brief, documents: artifact.documents };
        if (!(frozen as any).artifact || editorialHash((frozen as any).artifact) !== editorialHash(rawArtifact)) rowBlockers.push('frozen_artifact_mismatch');
      }
      const full = (artifact.originalEditorialContext || input?.originalEditorialContext
        || (artifact.brief as typeof artifact.brief & { editorialContext?: OriginalEditorialContext })?.editorialContext);
      if (full?.contextVersion !== ORIGINAL_EDITORIAL_CONTEXT_VERSION || !full.subject || !full.author
        || !validContext(full) || !Array.isArray(full.exampleRefs) || full.exampleRefs.length !== full.voiceExamples.length
        || !Array.isArray(full.ownerRestrictions) || !full.ownerRestrictions.every(rule => nonempty(rule.text))
        || !Array.isArray(full.stylePreferences) || !full.stylePreferences.every(rule => nonempty(rule.text))
        || !Array.isArray(full.forecastExpectations) || !Array.isArray(full.subject.sourceIds)
        || !Array.isArray(full.subject.permittedModes)) rowBlockers.push('missing_full_context');
      else {
        if (!full.subject.permittedModes.includes(artifact.idea?.contentMode || full.contentMode)) rowBlockers.push('content_mode_not_permitted');
        if (editorialHash(sharedFields.map(key => full[key])) !== editorialHash(sharedFields.map(key => context?.[key]))) rowBlockers.push('policy_context_mismatch');
        if (!(Date.parse(full.subject.expiresAt) > now)) rowBlockers.push('stale_context');
      }
      const packet = artifact.brief?.subjectPacket;
      if (!artifact.brief || !packet) rowBlockers.push('missing_subject_packet');
      else {
        if (!(Date.parse(packet.expiresAt) > now)) rowBlockers.push('stale_evidence');
        const documents = artifact.documents;
        if (!Array.isArray(documents) || !Array.isArray(packet.sourceIds) || !Array.isArray(artifact.brief.sourceDocumentIds)
          || (full?.subject && editorialHash(packet.sourceIds) !== editorialHash(full.subject.sourceIds))
          || (documents && documents.some(source => !source?.metadata || !isCurrentSourceEvidence(source, now)))
          || [...packet.sourceIds || [], ...artifact.brief.sourceDocumentIds || []].some(id => !documents?.some(source => source.id === id))) rowBlockers.push('invalid_evidence');
      }
    }
    return { id: example.id, provenance: frozen ? 'frozen_supplement' as const : 'retained_saved_artifact' as const,
      inputHash: entry ? editorialReadinessInputHash(entry) : null, ready: rowBlockers.length === 0, blockers: [...new Set(rowBlockers)] };
  });
  const safetyCases = options.safetyCases ?? [];
  const missingCases = REQUIRED_EDITORIAL_SAFETY_CASES.filter(caseName => !safetyCases.some(row => row.case === caseName));
  const invalidSafety = safetyCases.some(row => !REQUIRED_EDITORIAL_SAFETY_CASES.includes(row.case) || !nonempty(row.id) || !nonempty(row.content)
    || row.contentHash !== editorialHash(row.content) || !validContext(row.context) || row.contextHash !== editorialHash(row.context));
  if (missingCases.length) blockers.push('missing_safety_inputs');
  if (invalidSafety || new Set(safetyCases.map(row => row.case)).size !== safetyCases.length
    || new Set(safetyCases.map(row => row.id)).size !== safetyCases.length) blockers.push('invalid_safety_inputs');
  const preparationHash = editorialHash({ version: EDITORIAL_READINESS_VERSION, bundleHash: view.evaluationViewHash,
    entries: entries.map(entry => [entry.id, editorialReadinessInputHash(entry)]).sort(([a], [b]) => a.localeCompare(b)),
    safetyCases, activeBaseline: options.activeBaseline ?? null });
  const quote = options.budgetQuote;
  if (!quote) blockers.push('missing_whole_evaluation_quote');
  else if (quote.quotedInputHash !== preparationHash) blockers.push('budget_quote_input_mismatch');
  else if (!Number.isFinite(quote.remainingUsd) || quote.remainingUsd < 0 || !Number.isFinite(quote.maximumCommitmentUsd)
    || quote.maximumCommitmentUsd <= 0) blockers.push('invalid_budget_quote');
  else if (quote.maximumCommitmentUsd > quote.remainingUsd) blockers.push('evaluation_budget_insufficient');
  return { version: EDITORIAL_READINESS_VERSION, evaluationOnly: true as const, preparationHash, bundleHash: view.evaluationViewHash,
    ready: rows.every(row => row.ready) && blockers.length === 0, blockers, rows,
    safety: { missingCases, suppliedCases: safetyCases.map(row => ({ case: row.case, id: row.id, contentHash: row.contentHash, contextHash: row.contextHash })) },
    budget: quote ?? null };
}
