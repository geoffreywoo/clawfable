import type { DraftCandidate, Tweet, TweetPerformance } from './types';
import type { OwnerAuthorshipAttestation } from './owner-authorship';
import { normalizedAuthorshipText } from './owner-authorship';
import { eligibleOriginalVoiceExamples, ORIGINAL_VOICE_EXAMPLE_LIMIT, type OriginalVoiceExample } from './original-editorial-context';
import { selectNativeReactionAnchors } from './generation-v2';
import { selectCrossTopicDictionAnchors, selectRegisterMatchedDictionAnchors } from './voice-anchor-selection';

type VoiceReference = TweetPerformance & { agentId?: string; copied?: boolean; reservedForEvaluation?: boolean; holdout?: boolean };
const heldOutOrCopied = (row: VoiceReference) => Boolean(row.copied || row.reservedForEvaluation || row.holdout || row.experimentHoldout);

/** An exact, explicitly composed manual row may be human; app membership alone is not generation. */
function safeComposedMatch(tweet: Tweet, reference: TweetPerformance, agentId: string): boolean {
  return reference.authorshipProvenance === 'operator_composed' && tweet.agentId === agentId && tweet.type === 'original'
    && typeof reference.xTweetId === 'string' && Boolean(reference.xTweetId.trim()) && tweet.xTweetId === reference.xTweetId
    && normalizedAuthorshipText(tweet.content) === normalizedAuthorshipText(reference.content)
    && !tweet.generationProvider && !tweet.generationModel && !tweet.generationMode && !tweet.sourceLane
    && tweet.candidateScore == null && tweet.judgeScore == null && !tweet.pipelineVersion && !tweet.generationSurface
    && !tweet.generationRunId && !tweet.generationTriggerId && !tweet.generationIdempotencyKey && !tweet.draftCandidateId
    && !tweet.ideaId && !tweet.parentDraftCandidateId && !tweet.parentTweetId && !tweet.parentIdeaId
    && !tweet.draftExperimentId && !tweet.experimentBatchId && !tweet.experimentHoldout
    && (tweet.contentProvenance == null || tweet.contentProvenance === 'operator_written');
}

/** Select from genuine authored copy before the three-example budget is spent. */
export function selectOriginalProductionVoiceExamples(input: {
  agentId: string; references: TweetPerformance[]; tweets: Tweet[]; drafts: DraftCandidate[];
  attestation?: OwnerAuthorshipAttestation | null; subjectTexts: string[];
}): OriginalVoiceExample[] {
  const attested = input.attestation?.agentId === input.agentId
    && input.attestation.scope === 'posts_published_outside_clawfable' && input.attestation.source === 'explicit_owner_statement'
    && typeof input.attestation.id === 'string' && Boolean(input.attestation.id.trim());
  const draftTexts = new Set(input.drafts.map(draft => normalizedAuthorshipText(draft.content)));
  const conflicting = input.references.filter(reference => reference.authorshipProvenance === 'known_clawfable_generated'
    || reference.source === 'autopilot' || heldOutOrCopied(reference)
    || reference.voiceCorpusDispositions?.some(disposition => ['mechanics_only', 'negative', 'excluded'].includes(disposition)));
  const conflictingIds = new Set(conflicting.map(reference => reference.xTweetId));
  const conflictingTexts = new Set(conflicting.map(reference => normalizedAuthorshipText(reference.content)));
  const examples = input.references.flatMap(reference => {
    const row = reference as VoiceReference;
    if (row.agentId && row.agentId !== input.agentId || reference.source === 'autopilot' || reference.isTextComplete === false || reference.referenceType
      || typeof reference.xTweetId !== 'string' || !reference.xTweetId.trim() || reference.xTweetId !== reference.xTweetId.trim()
      || typeof reference.content !== 'string' || heldOutOrCopied(row)
      || reference.draftExperimentId || reference.experimentBatchId
      || reference.tweetId && !input.tweets.some(tweet => tweet.id === reference.tweetId && safeComposedMatch(tweet, reference, input.agentId))) return [];
    const text = normalizedAuthorshipText(reference.content);
    if (draftTexts.has(text) || conflictingIds.has(reference.xTweetId) || conflictingTexts.has(text)
      || input.tweets.some(tweet => (tweet.xTweetId === reference.xTweetId || normalizedAuthorshipText(tweet.content) === text)
      && !safeComposedMatch(tweet, reference, input.agentId))) return [];
    return [{ id: reference.xTweetId, content: reference.content, topic: reference.topic || '',
      provenance: reference.authorshipProvenance || 'unknown', dispositions: reference.voiceCorpusDispositions || [],
      ...(attested ? { authorshipAttestationId: input.attestation!.id } : {}) }];
  });
  const eligible = eligibleOriginalVoiceExamples(examples);
  const anchors = eligible.map(example => ({ id: example.id, content: example.content, topic: example.topic || '' }));
  const local = new Set(selectRegisterMatchedDictionAnchors(anchors, input.subjectTexts, anchors.length).map(anchor => anchor.id));
  const crossTopic = new Set(selectCrossTopicDictionAnchors(anchors, input.subjectTexts, anchors.length).map(anchor => anchor.id));
  return selectNativeReactionAnchors(anchors, input.subjectTexts, ORIGINAL_VOICE_EXAMPLE_LIMIT).map(anchor => ({
    ...eligible.find(example => example.id === anchor.id)!,
    selectionReason: local.has(anchor.id) ? 'subject_register' : crossTopic.has(anchor.id) ? 'cross_topic_diction' : 'authored_range',
  }));
}
