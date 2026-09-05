import { createHash } from 'node:crypto';
import {
  generateTweetBatchV2, buildGenerationBriefsV2, buildVoiceGuidanceV2, isV2VoiceReady,
  type GenerateTweetBatchV2Input, type GenerationBriefV2,
} from './generation-v2';
import { getModelChainForTask } from './ai';
import { estimateAiUsageCostUsd } from './ai-pricing';
import { ASTRA_EVALUATION_VERSION, GEOFFREY_EVALUATION_SUBJECTS, SYNTHETIC_AUTHOR_FIXTURES } from './astra-evaluation-fixtures';
import type { GenerationContext } from './generation-context';
import type { AccountAnalysis, DraftCandidate, GenerationRunTrace, SourceDocument, StoryCluster, SemanticBlock, IdeaCandidate, TweetPerformance, ManualExampleCuration, VoiceCorpusSnapshot } from './types';
import type { VoiceProfile } from './soul-parser';
import type { RankedPublishingCandidate } from './publishing-candidate';
import { researchTokenSimilarity } from './research-utils';
import { DEFAULT_CONTENT_STYLE } from './content-style';

type FrozenInput = Omit<GenerateTweetBatchV2Input, 'modelStack' | 'onTrace' | 'onArtifacts'>;
export interface FrozenEvaluationPacket {
  id: string;
  kind: 'geoffrey' | 'synthetic_profile';
  subject: string;
  calibrationSource: 'captured_account_references' | 'synthetic_fixture_no_human_ground_truth';
  input: FrozenInput;
}
export interface FrozenEvaluationSnapshot {
  version: string;
  capturedAt: string;
  account: { id: string; handle: string };
  heldoutExamples: Array<{ id: string; content: string; source: 'captured_operator_reference';
    provenance: 'operator_composed_verified' | 'operator_curated_authorship_unverified' | 'account_reference_authorship_unverified' }>;
  referenceSummary: { heldoutVerifiedComposed: number; heldoutCuratedAuthorshipUnverified: number; heldoutAccountReferenceAuthorshipUnverified: number;
    calibrationCount: number; limitation: string | null };
  packets: FrozenEvaluationPacket[];
  hash: string;
}

/** Describes the frozen inputs; it does not recapture or relabel their evidence. */
export function frozenEvaluationCoverage(snapshot: FrozenEvaluationSnapshot) {
  const packets = snapshot.packets.map((packet) => {
    const briefs = packet.input.previewContext?.briefs || [];
    const documents = packet.input.previewContext?.documents || [];
    const references = packet.input.learnings?.operatorVoiceReference;
    const anchors = [...(references?.pinnedExamples || []), ...(references?.startupRegisterExamples || []), ...(references?.bestPerformers || [])];
    return { id: packet.id, kind: packet.kind, subject: packet.subject,
      evidenceModes: [...new Set(briefs.map((brief) => brief.evidenceMode))],
      sourceLanes: [...new Set(briefs.map((brief) => brief.sourceLane))],
      evidenceAtoms: briefs.reduce((sum, brief) => sum + brief.evidence.length, 0),
      qualifiedClaimIds: [...new Set(briefs.flatMap((brief) => brief.qualifiedClaimIds))],
      sourceDocumentIds: [...new Set(documents.map((document) => document.id))],
      personalSubjectCues: briefs.reduce((sum, brief) => sum + (brief.personalTopicSignals?.length || 0), 0),
      hasCreativeSeed: briefs.some((brief) => Boolean(brief.creativeSeed)),
      calibrationAnchors: new Set(anchors.map((entry) => entry.content?.trim()).filter(Boolean)).size,
      verifiedComposedAnchors: anchors.filter((entry) => entry.authorshipProvenance === 'operator_composed').length,
      voiceReady: isV2VoiceReady({ ...packet.input, modelStack: 'publishing_v2_gpt_control' }),
      calibrationSource: packet.calibrationSource,
    };
  });
  const cohorts = (['geoffrey', 'synthetic_profile'] as const).map((kind) => {
    const rows = packets.filter((packet) => packet.kind === kind);
    return { kind, packets: rows.length,
      verifiedSourcePackets: rows.filter((packet) => packet.evidenceModes.includes('verified_source')).length,
      opinionOnlyPackets: rows.filter((packet) => packet.evidenceModes.every((mode) => mode === 'operator_opinion')).length,
      packetsWithPersonalSubjectCues: rows.filter((packet) => packet.personalSubjectCues > 0).length,
      evidenceAtoms: rows.reduce((sum, packet) => sum + packet.evidenceAtoms, 0),
      uniqueSourceDocuments: new Set(rows.flatMap((packet) => packet.sourceDocumentIds)).size,
      uniqueQualifiedClaims: new Set(rows.flatMap((packet) => packet.qualifiedClaimIds)).size,
    };
  });
  return { schemaVersion: 1, snapshotHash: snapshot.hash, capturedAt: snapshot.capturedAt,
    benchmarkKind: 'requested_topic_breadth_stress' as const,
    sampling: 'Thirty hand-authored Geoffrey subjects with source matching and opinion fallback; ten synthetic profiles. Not an empirical sample of production traffic.',
    limitations: [
      'Source-free cases test owned opinions and cannot establish qualified-source coverage.',
      'Synthetic fixtures do not establish real-account voice fit or human preference.',
      ...(snapshot.referenceSummary.limitation ? [snapshot.referenceSummary.limitation] : []),
    ], referenceSummary: snapshot.referenceSummary, cohorts, packets };
}

const CREDENTIAL_FIELD = /^(?:.*api[_-]?key|.*access[_-]?(?:token|secret)|.*refresh[_-]?token|.*oauth.*|.*password|.*credentials|.*secret|cookies?|authorization)$/i;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function evaluationHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function scrub(value: unknown, excluded: string[] = []): unknown {
  const matches = (text: string) => excluded.some((entry) => (
    text.includes(entry) || (entry.length >= 64 && text.includes(entry.slice(0, 64)))
  ));
  if (typeof value === 'string') return matches(value) ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, excluded)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (['content', 'text', 'originalDraft', 'editedDraft'].some((key) => typeof object[key] === 'string' && matches(object[key] as string))) return undefined;
    return Object.fromEntries(Object.entries(object).flatMap(([key, child]) => {
      if (CREDENTIAL_FIELD.test(key)) return [];
      const clean = scrub(child, excluded);
      return clean === undefined ? [] : [[key, clean]];
    }));
  }
  return value;
}

export function validateFrozenEvaluation(snapshot: FrozenEvaluationSnapshot): { packets: number; geoffrey: number; synthetic: number; hash: string } {
  const { hash, ...body } = snapshot;
  if (snapshot.version !== ASTRA_EVALUATION_VERSION || hash !== evaluationHash(body)) throw new Error('Frozen evaluation version/hash mismatch.');
  if (snapshot.packets.length !== 40 || new Set(snapshot.packets.map((packet) => packet.id)).size !== 40) throw new Error('A full evaluation requires 40 unique packets.');
  const geoffrey = snapshot.packets.filter((packet) => packet.kind === 'geoffrey').length;
  if (geoffrey !== 30 || snapshot.packets.filter((packet) => packet.kind === 'synthetic_profile').length !== 10) throw new Error('Expected 30 Geoffrey and 10 synthetic-profile packets.');
  if (snapshot.heldoutExamples.length < 3 || snapshot.heldoutExamples.some((example) => !['operator_composed_verified', 'operator_curated_authorship_unverified', 'account_reference_authorship_unverified'].includes(example.provenance))) throw new Error('At least three real held-out references with explicit composition, curation, or active-corpus provenance are required.');
  const effectiveBriefs = new Set<string>();
  for (const packet of snapshot.packets) {
    if (packet.input.mode !== 'preview' || packet.input.persistArtifacts !== false || !packet.input.previewContext?.briefs.length) throw new Error(`Unsafe or empty frozen packet ${packet.id}.`);
    if (!isV2VoiceReady({ ...packet.input, modelStack: 'publishing_v2_gpt_control' })) throw new Error(`Frozen packet ${packet.id} has insufficient separate calibration anchors.`);
    const serialized = JSON.stringify(packet.input);
    const briefKey = evaluationHash(packet.input.previewContext!.briefs.map((brief) => ({
      topic: brief.topic, title: brief.title, evidenceMode: brief.evidenceMode, evidence: brief.evidence, creativeSeed: brief.creativeSeed || null,
    })));
    if (effectiveBriefs.has(briefKey)) throw new Error(`Duplicated effective brief in ${packet.id}.`);
    effectiveBriefs.add(briefKey);
    if (snapshot.heldoutExamples.some((example) => serialized.includes(example.content) || (example.content.length >= 64 && serialized.includes(example.content.slice(0, 64))))) throw new Error(`Held-out example leaked into ${packet.id}.`);
    if (canonical(packet.input) !== canonical(scrub(packet.input))) throw new Error(`Credential field found in ${packet.id}.`);
  }
  return { packets: 40, geoffrey, synthetic: 10, hash };
}

export function createFrozenEvaluationSnapshot({
  account, context, baseVoiceProfile, analysis, documents, stories, blocks = [], recentIdeas = [], referenceEvidence, now = new Date(),
}: {
  account: { id: string; handle: string };
  context: GenerationContext;
  baseVoiceProfile: VoiceProfile;
  analysis: AccountAnalysis;
  documents: SourceDocument[];
  stories: StoryCluster[];
  blocks?: SemanticBlock[];
  recentIdeas?: IdeaCandidate[];
  referenceEvidence?: { history: TweetPerformance[]; curation: ManualExampleCuration; corpus: VoiceCorpusSnapshot | null };
  now?: Date;
}): FrozenEvaluationSnapshot {
  const reference = context.learnings?.operatorVoiceReference;
  const corpusById = new Map((referenceEvidence?.corpus?.entries || []).map((entry) => [entry.xTweetId, entry]));
  const pinnedIds = new Set([
    ...(referenceEvidence?.curation.pinnedXTweetIds || context.learnings?.manualExampleCuration?.pinnedXTweetIds || []),
    // This field is constructed from explicit manual curation in production.
    ...(reference?.pinnedExamples || []).map((entry) => entry.xTweetId).filter(Boolean),
  ]);
  const blockedIds = new Set([
    ...(referenceEvidence?.curation.blockedXTweetIds || context.learnings?.manualExampleCuration?.blockedXTweetIds || []),
    ...(reference?.blockedXTweetIds || []),
  ]);
  const seen = new Set<string>();
  const references = [...(reference?.pinnedExamples || []), ...(reference?.startupRegisterExamples || []), ...(reference?.bestPerformers || []),
    ...(referenceEvidence?.history || []).filter((entry) => pinnedIds.has(entry.xTweetId)
      || corpusById.get(entry.xTweetId)?.dispositions.includes('diction_anchor')),
  ].map((entry) => {
    const corpusEntry = corpusById.get(entry.xTweetId);
    return corpusEntry ? { ...entry, authorshipProvenance: corpusEntry.provenance,
      authorshipConfidence: corpusEntry.authorshipConfidence, voiceCorpusDispositions: corpusEntry.dispositions,
      voiceCorpusVersion: referenceEvidence!.corpus!.snapshotId } : entry;
  }).filter((entry) => {
    if (!entry.content?.trim() || seen.has(entry.content) || blockedIds.has(entry.xTweetId)
      || entry.authorshipProvenance === 'known_clawfable_generated'
      || entry.voiceCorpusDispositions?.some((value) => ['excluded', 'negative'].includes(value))) return false;
    seen.add(entry.content);
    return true;
  });
  const heldoutPool = references.filter((entry) => entry.authorshipProvenance === 'operator_composed' || pinnedIds.has(entry.xTweetId)
    || (referenceEvidence?.corpus?.active === true && corpusById.get(entry.xTweetId)?.dispositions.includes('diction_anchor')))
    .sort((a, b) => {
      const tier = (entry: TweetPerformance) => entry.authorshipProvenance === 'operator_composed' ? 0 : pinnedIds.has(entry.xTweetId) ? 1 : 2;
      return tier(a) - tier(b) || evaluationHash(a.content).localeCompare(evaluationHash(b.content));
    });
  if (context.learnings?.voiceCorpus?.active !== true || heldoutPool.length < 3) throw new Error('Capture needs an active voice corpus and at least three eligible account references with composition, curation, or active-corpus provenance to hold out.');
  const heldoutExamples = heldoutPool.slice(0, 3).map((entry) => ({
    id: entry.xTweetId || entry.tweetId || evaluationHash(entry.content), content: entry.content, source: 'captured_operator_reference' as const,
    provenance: entry.authorshipProvenance === 'operator_composed' ? 'operator_composed_verified' as const
      : pinnedIds.has(entry.xTweetId) ? 'operator_curated_authorship_unverified' as const : 'account_reference_authorship_unverified' as const,
  }));
  const excluded = heldoutExamples.map((entry) => entry.content);
  const calibration = references.filter((entry) => !excluded.includes(entry.content)
    && (entry.source === 'manual' || ['operator_composed', 'timeline_unmatched'].includes(entry.authorshipProvenance || ''))).slice(0, 16);
  if (calibration.length < 3) throw new Error('Capture needs at least three separate production-eligible calibration references after holding out examples.');
  const referenceSummary = {
    heldoutVerifiedComposed: heldoutExamples.filter((entry) => entry.provenance === 'operator_composed_verified').length,
    heldoutCuratedAuthorshipUnverified: heldoutExamples.filter((entry) => entry.provenance === 'operator_curated_authorship_unverified').length,
    heldoutAccountReferenceAuthorshipUnverified: heldoutExamples.filter((entry) => entry.provenance === 'account_reference_authorship_unverified').length,
    calibrationCount: calibration.length,
    limitation: heldoutExamples.some((entry) => entry.provenance !== 'operator_composed_verified')
      ? 'Some held-out references come from the active account voice corpus or explicit curation; their original authorship is unverified. They measure account-reference fit, not verified human composition or human preference.' : null,
  };
  const cleanContext = scrub(context, excluded) as GenerationContext;
  cleanContext.learnings!.operatorVoiceReference = { ...cleanContext.learnings!.operatorVoiceReference!,
    pinnedExamples: calibration.filter((entry) => pinnedIds.has(entry.xTweetId)),
    startupRegisterExamples: [], bestPerformers: calibration,
  };
  const guidance = buildVoiceGuidanceV2(context.voiceProfile, { budget: 2400, includeRawProse: false });
  cleanContext.voiceProfile = { ...baseVoiceProfile, communicationStyle: [baseVoiceProfile.communicationStyle,
    ...guidance.learnedSections.filter((section) => !excluded.some((example) => section.body.includes(example.slice(0, 64))))
      .map((section) => `## ${section.heading}\n${section.body}`),
  ].join('\n\n') };
  const safeAnalysis = scrub(analysis, excluded) as AccountAnalysis;
  const common = {
    agentId: account.id, count: 1, voiceProfile: cleanContext.voiceProfile, analysis: safeAnalysis,
    learnings: cleanContext.learnings, style: cleanContext.style, recentPosts: cleanContext.recentPosts,
    allTweets: cleanContext.allTweets, memory: cleanContext.memory, signals: cleanContext.signals,
    trending: null, mode: 'preview' as const, persistArtifacts: false, requireAutopostQuality: true,
  };
  const usedStoryIds = new Set<string>();
  const packets: FrozenEvaluationPacket[] = GEOFFREY_EVALUATION_SUBJECTS.map((subject, index) => {
    const planning = { ...common, count: 1, documents, stories, blocks, recentIdeas, now };
    const relevantStories = stories.filter((story) => !usedStoryIds.has(story.id) && researchTokenSimilarity(subject, `${story.topic} ${story.title}`) >= 0.12)
      .sort((a, b) => researchTokenSimilarity(subject, `${b.topic} ${b.title}`) - researchTokenSimilarity(subject, `${a.topic} ${a.title}`));
    const sourced = relevantStories.length > 0 ? buildGenerationBriefsV2({ ...planning, stories: relevantStories })
      .find((brief) => brief.storyClusterId && relevantStories.some((story) => story.id === brief.storyClusterId)) : undefined;
    const brief = sourced || buildGenerationBriefsV2({ ...planning, requestedTopic: subject })[0];
    if (!brief) throw new Error(`No policy-eligible frozen context for ${subject}.`);
    if (brief.storyClusterId) usedStoryIds.add(brief.storyClusterId);
    const ids = new Set(brief.sourceDocumentIds);
    return { id: `geoffrey-${String(index + 1).padStart(2, '0')}`, kind: 'geoffrey', subject,
      calibrationSource: 'captured_account_references', input: { ...common,
        previewContext: { briefs: [brief], documents: documents.filter((document) => ids.has(document.id)), stories: stories.filter((story) => story.id === brief.storyClusterId), blocks, recentIdeas: [] },
      } };
  });
  for (const fixture of SYNTHETIC_AUTHOR_FIXTURES) {
    const profile: VoiceProfile = {
      tone: fixture.tone, topics: [fixture.topic], antiGoals: ['Invented personal events', 'Interchangeable advice'],
      communicationStyle: `${fixture.tone}. Match the calibration examples without reusing their premises.`,
      summary: 'Synthetic evaluation persona. Its calibration examples are invented fixtures, not real posts or measured human preferences.',
    };
    const examples = fixture.examples.map((content, index) => ({ content, topic: fixture.topic, tweetId: `${fixture.id}-synthetic-${index}`,
      source: 'manual', authorshipProvenance: 'operator_composed' })) as TweetPerformance[];
    const syntheticInput = { ...common, agentId: `synthetic-${fixture.id}`, voiceProfile: profile,
      analysis: { agentId: `synthetic-${fixture.id}`, analyzedAt: now.toISOString(), tweetCount: 0, viralTweets: [],
        engagementPatterns: { topTopics: [fixture.topic] }, followingProfile: {}, warnings: ['Synthetic persona; no measured performance.'], contentFingerprint: fixture.tone,
      } as AccountAnalysis,
      learnings: { voiceCorpus: { active: true, minimumAnchorCount: 3, snapshotId: `synthetic:${fixture.id}` },
        operatorVoiceReference: { pinnedExamples: examples, startupRegisterExamples: [], bestPerformers: [] },
      } as unknown as GenerateTweetBatchV2Input['learnings'],
      memory: null, signals: [], allTweets: [], recentPosts: [],
      style: { ...DEFAULT_CONTENT_STYLE, trendMixTarget: 0 },
    };
    const brief = buildGenerationBriefsV2({ ...syntheticInput, requestedTopic: fixture.topic, stories: [], documents: [], now })[0];
    packets.push({ id: `synthetic-${fixture.id}`, kind: 'synthetic_profile', subject: fixture.topic,
      calibrationSource: 'synthetic_fixture_no_human_ground_truth', input: { ...syntheticInput, previewContext: { briefs: [brief], documents: [] } },
    });
  }
  const body = scrub({ version: ASTRA_EVALUATION_VERSION, capturedAt: now.toISOString(), account, heldoutExamples, referenceSummary, packets }) as Omit<FrozenEvaluationSnapshot, 'hash'>;
  const snapshot = { ...body, hash: evaluationHash(body) };
  validateFrozenEvaluation(snapshot);
  return snapshot;
}

export interface EvaluationArmResult {
  stack: 'publishing_v2_gpt_control' | 'publishing_v2_astra';
  selected: RankedPublishingCandidate[];
  ideas: IdeaCandidate[];
  drafts: DraftCandidate[];
  trace: GenerationRunTrace | null;
  validPrimaryModels: boolean;
  invalidReason: string | null;
  /** Attempted includes a failed request; it never means successful generation. */
  attempted?: boolean;
  executionEnvironment?: { kind: 'remote'; origin: string; gitCommit: string };
}
export interface EvaluationComparison {
  version: string;
  snapshotHash: string;
  completed: boolean;
  attemptedCompletion?: boolean;
  estimatedCostUsd: number | null;
  knownEstimatedCostUsd?: number;
  unknownCostArms?: number;
  reservedUnknownCostUsd?: number;
  reservedUnknownAttempts?: number;
  unreservedUnknownAttempts?: number;
  budgetMeasureUsd?: number;
  coverage?: ReturnType<typeof frozenEvaluationCoverage>;
  execution?: {
    concurrency: number;
    maxEstimatedCostUsd: number;
    budgetPolicy: 'observed_cost_stop_with_in_flight_drain' | 'known_cost_plus_unknown_reservations_with_in_flight_drain';
    failurePolicy?: 'fail_fast' | 'complete_suite';
    stopReason: 'invalid_arm' | 'cost_budget' | 'interrupted' | 'progress_write_failed' | 'unknown_cost' | 'authentication_failure' | 'integrity_failure' | null;
  };
  packets: Array<{ id: string; kind: FrozenEvaluationPacket['kind']; baseline: EvaluationArmResult; astra: EvaluationArmResult }>;
}
export type EvaluationArmRunner = (packet: FrozenEvaluationPacket, stack: EvaluationArmResult['stack']) => Promise<EvaluationArmResult>;

export function validateFrozenEvaluationAge(capturedAt: string, now = new Date()): void {
  const age = now.getTime() - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age > 7 * 24 * 60 * 60 * 1000) throw new Error('Capture a fresh snapshot: comparison evidence is frozen as-of capture and expires after seven days.');
}

function matchesEvaluationModel(primaryModel: string, reportedModel: string): boolean {
  // OpenAI explicitly documents gpt-5.6 as an alias for Sol (verified 2026-09-04):
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  // Keep the allowlist exact: Terra, Luna, and arbitrary suffixes are different models.
  const identities = primaryModel === 'gpt-5.6' ? [primaryModel, 'gpt-5.6-sol'] : [primaryModel];
  return identities.some((identity) => reportedModel === identity
    || (reportedModel.startsWith(`${identity}-`) && /^\d{4}-\d{2}-\d{2}$/.test(reportedModel.slice(identity.length + 1))));
}

/** One identical non-persisting arm, shared by local and protected remote execution. */
export async function runFrozenEvaluationArm(packet: FrozenEvaluationPacket, stack: EvaluationArmResult['stack'], options: {
  generate?: typeof generateTweetBatchV2;
} = {}): Promise<EvaluationArmResult> {
  if (!['publishing_v2_gpt_control', 'publishing_v2_astra'].includes(stack)
    || packet.input.mode !== 'preview' || packet.input.persistArtifacts !== false
    || packet.input.requireAutopostQuality !== true || packet.input.count !== 1
    || packet.input.previewContext?.briefs.length !== 1 || !Array.isArray(packet.input.previewContext.documents)) {
    throw new Error('Unsafe frozen evaluation arm.');
  }
  const generate = options.generate || generateTweetBatchV2;
  let trace: GenerationRunTrace | null = null;
  let drafts: DraftCandidate[] = [];
  let ideas: IdeaCandidate[] = [];
  let selected: RankedPublishingCandidate[] = [];
  let failure: string | null = null;
  try {
    selected = await generate({ ...structuredClone(packet.input), modelStack: stack,
      onTrace: (value) => { trace = value; }, onArtifacts: (artifacts) => { drafts = artifacts.drafts; ideas = artifacts.ideas; },
    });
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const completedTrace = trace as GenerationRunTrace | null;
  const invalidCalls = (completedTrace?.modelCalls || []).filter((call) => {
    if (!call.succeeded) return false;
    const task = ({ idea_generation: 'idea_generation', idea_judgment: 'idea_judgment', tweet_writing: 'tweet_writing', copy_judgment: 'copy_judgment' } as const)[call.stage];
    if (!task) return true;
    const primary = getModelChainForTask(task, stack)[0];
    const reportedModel = call.providerModel;
    const reportedMatchesPrimary = typeof reportedModel === 'string' && reportedModel.length > 0
      && Boolean(primary && matchesEvaluationModel(primary.model, reportedModel));
    return !primary || call.model !== primary.model || call.provider !== primary.provider || !reportedMatchesPrimary;
  });
  const successfulCalls = completedTrace?.modelCalls?.filter((call) => call.succeeded) || [];
  const invalidReason = failure || (!completedTrace ? 'missing_trace'
    : !['completed', 'empty'].includes(completedTrace.status) ? completedTrace.error || 'generation_failed'
    : invalidCalls.length ? 'provider_or_model_substitution'
    : successfulCalls.length === 0 ? 'no_successful_model_calls'
    : !hasKnownArmCost({ trace: completedTrace }) ? 'unknown_evaluation_cost'
    : null);
  return { stack, selected, ideas, drafts, trace: completedTrace, validPrimaryModels: invalidReason === null, invalidReason, attempted: true };
}

function frozenArmFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/HTTP (?:401|403)\b/.test(message)) return 'evaluation_authentication_failed';
  if (/HTTP 409\b|deployment|version\/hash|does not match the frozen arm|Unsafe frozen|Invalid or oversized remote/.test(message)) return 'evaluation_integrity_failed';
  return 'evaluation_arm_execution_failed_cost_unknown';
}

/** Usage-derived costs and conservative unknown-attempt reservations stay separate. */
export function evaluationArmCost(arm: Pick<EvaluationArmResult, 'trace'>) {
  const trace = arm.trace;
  const finiteCost = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const summaryComplete = finiteCost(trace?.estimatedCostUsd) && !['partial', 'missing'].includes(trace?.costDataStatus || '');
  if (summaryComplete) return { knownEstimatedCostUsd: trace!.estimatedCostUsd!, reservedUnknownCostUsd: 0,
    reservedUnknownAttempts: 0, unreservedUnknownAttempts: 0, costKnown: true, budgetBounded: true };
  let knownEstimatedCostUsd = 0, reservedUnknownCostUsd = 0, reservedUnknownAttempts = 0, unreservedUnknownAttempts = 0;
  if (!Array.isArray(trace?.modelCalls)) {
    // Legacy partial summaries can retain a known subtotal, but cannot bound the missing attempt.
    knownEstimatedCostUsd = finiteCost(trace?.estimatedCostUsd) ? trace!.estimatedCostUsd! : 0;
    unreservedUnknownAttempts = 1;
  } else for (const call of trace.modelCalls) {
    const fallbacks = call.fallbackAttempts || [];
    // Failed calls mirror their final fallback; count that provider attempt only once.
    const attempts = [...fallbacks, ...(call.succeeded || (fallbacks.length === 0 && call.provider && call.model) ? [call] : [])];
    if (attempts.length === 0) unreservedUnknownAttempts += 1;
    for (const attempt of attempts) {
      if ('reason' in attempt && attempt.reason === 'provider_unconfigured') continue; // No HTTP request was made.
      const cost = finiteCost(attempt.estimatedCostUsd) ? attempt.estimatedCostUsd
        : estimateAiUsageCostUsd(attempt.model, attempt.inputTokens, attempt.outputTokens);
      if (finiteCost(cost)) { knownEstimatedCostUsd += cost; continue; }
      const progress = attempt.responseProgress;
      const auditable = attempt.provider === 'openai' && attempt.model === 'gpt-6-astra'
        && progress && finiteCost(progress.estimatedMaxCostUsd) && progress.estimatedMaxCostUsd > 0
        && Number.isInteger(progress.requestBytes) && progress.requestBytes! > 0
        && Number.isInteger(progress.framingTokenAllowance) && progress.framingTokenAllowance! > 0
        && progress.inputTokenUpperEstimate === progress.requestBytes! + progress.framingTokenAllowance!
        && Number.isInteger(progress.outputTokenLimit) && progress.outputTokenLimit! > 0
        && progress.estimatedMaxCostUsd === estimateAiUsageCostUsd(attempt.model, progress.inputTokenUpperEstimate, progress.outputTokenLimit);
      if (auditable) { reservedUnknownCostUsd += progress!.estimatedMaxCostUsd!; reservedUnknownAttempts += 1; }
      else unreservedUnknownAttempts += 1;
    }
  }
  return { knownEstimatedCostUsd, reservedUnknownCostUsd, reservedUnknownAttempts, unreservedUnknownAttempts,
    costKnown: reservedUnknownAttempts + unreservedUnknownAttempts === 0, budgetBounded: unreservedUnknownAttempts === 0 };
}

function hasKnownArmCost(arm: Pick<EvaluationArmResult, 'trace'>): boolean { return evaluationArmCost(arm).costKnown; }

export async function runFrozenEvaluation(snapshot: FrozenEvaluationSnapshot, options: {
  generate?: typeof generateTweetBatchV2;
  runArm?: EvaluationArmRunner;
  maxEstimatedCostUsd?: number;
  limit?: number;
  concurrency?: number;
  failurePolicy?: 'fail_fast' | 'complete_suite';
  signal?: AbortSignal;
  onProgress?: (comparison: EvaluationComparison) => void | Promise<void>;
  now?: Date;
} = {}): Promise<EvaluationComparison> {
  validateFrozenEvaluation(snapshot);
  validateFrozenEvaluationAge(snapshot.capturedAt, options.now);
  const runArm: EvaluationArmRunner = options.runArm || ((packet, stack) => runFrozenEvaluationArm(packet, stack, { generate: options.generate }));
  const budget = options.maxEstimatedCostUsd ?? 100;
  const concurrency = options.concurrency ?? 1;
  const failurePolicy = options.failurePolicy ?? 'fail_fast';
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('A positive evaluation cost budget is required.');
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 40)) throw new Error('Evaluation limit must be an integer from 1 to 40.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Evaluation concurrency must be an integer from 1 to 4.');
  if (!['fail_fast', 'complete_suite'].includes(failurePolicy)) throw new Error('Invalid evaluation failure policy.');
  // Preflight every arm's safety contract before starting any paid worker,
  // including packets beyond a diagnostic limit.
  if (snapshot.packets.some((packet) => packet.input.requireAutopostQuality !== true || packet.input.count !== 1
    || packet.input.previewContext?.briefs.length !== 1 || !Array.isArray(packet.input.previewContext.documents))) {
    throw new Error('Unsafe frozen evaluation packet.');
  }
  const comparison: EvaluationComparison = { version: ASTRA_EVALUATION_VERSION, snapshotHash: snapshot.hash,
    completed: false, attemptedCompletion: false, estimatedCostUsd: 0, knownEstimatedCostUsd: 0, unknownCostArms: 0, reservedUnknownCostUsd: 0, reservedUnknownAttempts: 0, unreservedUnknownAttempts: 0, budgetMeasureUsd: 0, packets: [],
    coverage: frozenEvaluationCoverage(snapshot),
    execution: { concurrency, failurePolicy, maxEstimatedCostUsd: budget, budgetPolicy: 'known_cost_plus_unknown_reservations_with_in_flight_drain', stopReason: null },
  };
  const packets = snapshot.packets.slice(0, options.limit ?? 40);
  const slots: EvaluationComparison['packets'] = [];
  let nextPacket = 0;
  let progressWrites = Promise.resolve();
  let progressError: Error | undefined;
  const stop = (reason: NonNullable<EvaluationComparison['execution']>['stopReason']) => {
    comparison.execution!.stopReason ||= reason;
  };
  const schedulingBlock = (): string | null => {
    if (options.signal?.aborted) stop('interrupted');
    // Costs are known only after an arm returns. Stop new work at observed spend;
    // up to `concurrency` already-running arms can cross the ceiling while draining.
    if (comparison.budgetMeasureUsd! >= budget) stop('cost_budget');
    const reason = comparison.execution!.stopReason;
    return reason === 'invalid_arm' ? 'paired_run_aborted_after_invalid_arm'
      : reason === 'cost_budget' ? 'evaluation_cost_budget_reached'
      : reason === 'interrupted' ? 'evaluation_interrupted'
      : reason === 'unknown_cost' ? 'evaluation_stopped_unknown_cost'
      : reason === 'authentication_failure' ? 'evaluation_stopped_authentication_failure'
      : reason === 'integrity_failure' ? 'evaluation_stopped_integrity_failure'
      : reason === 'progress_write_failed' ? 'evaluation_progress_write_failed' : null;
  };
  const absent = (stack: EvaluationArmResult['stack'], invalidReason: string): EvaluationArmResult => ({
    stack, selected: [], ideas: [], drafts: [], trace: null, validPrimaryModels: false, invalidReason, attempted: false,
  });
  const invokeArm = async (packet: FrozenEvaluationPacket, stack: EvaluationArmResult['stack']): Promise<EvaluationArmResult> => {
    let result: EvaluationArmResult;
    try { result = { ...await runArm(packet, stack), attempted: true }; }
    catch (error) { result = { ...absent(stack, frozenArmFailure(error)), attempted: true }; }
    const providerAuthFailure = result.trace?.modelCalls?.some((call) => call.fallbackAttempts?.some((attempt) => [401, 403].includes(attempt.statusCode!)));
    if (result.invalidReason === 'evaluation_authentication_failed' || providerAuthFailure) stop('authentication_failure');
    else if (['evaluation_integrity_failed', 'deployment_changed_during_evaluation'].includes(result.invalidReason || '')) stop('integrity_failure');
    else if (!hasKnownArmCost(result) && (failurePolicy !== 'complete_suite' || !evaluationArmCost(result).budgetBounded)) stop('unknown_cost');
    else if (!result.validPrimaryModels && failurePolicy === 'fail_fast') stop('invalid_arm');
    return result;
  };
  const recordCost = (result: EvaluationArmResult): void => {
    if (!result.attempted) return;
    const cost = evaluationArmCost(result);
    comparison.knownEstimatedCostUsd! += cost.knownEstimatedCostUsd;
    comparison.reservedUnknownCostUsd! += cost.reservedUnknownCostUsd;
    comparison.reservedUnknownAttempts! += cost.reservedUnknownAttempts;
    comparison.unreservedUnknownAttempts! += cost.unreservedUnknownAttempts;
    if (!cost.costKnown) comparison.unknownCostArms! += 1;
    comparison.estimatedCostUsd = comparison.unknownCostArms ? null : comparison.knownEstimatedCostUsd!;
    comparison.budgetMeasureUsd = comparison.knownEstimatedCostUsd! + comparison.reservedUnknownCostUsd!;
    schedulingBlock();
  };
  const checkpoint = async (): Promise<void> => {
    // Slots retain snapshot order even when later packets finish first. Clone at
    // enqueue time and serialize writes so an older receipt cannot overwrite a newer one.
    comparison.packets = slots.filter(Boolean);
    comparison.attemptedCompletion = comparison.packets.length === 40
      && comparison.packets.every((entry) => entry.baseline.attempted && entry.astra.attempted);
    comparison.completed = comparison.attemptedCompletion && comparison.unknownCostArms === 0
      && comparison.packets.every((entry) => entry.baseline.validPrimaryModels && entry.astra.validPrimaryModels);
    const receipt = structuredClone(comparison);
    progressWrites = progressWrites.then(async () => {
      try { await options.onProgress?.(receipt); }
      catch (error) {
        progressError ||= error instanceof Error ? error : new Error(String(error));
        stop('progress_write_failed');
      }
    });
    await progressWrites;
  };
  const worker = async (): Promise<void> => {
    while (nextPacket < packets.length && !schedulingBlock()) {
      // Claim synchronously: each packet is scheduled once and its arms stay sequential.
      const index = nextPacket++;
      const packet = packets[index];
      const astraFirst = parseInt(evaluationHash(`${snapshot.hash}:${packet.id}`).slice(0, 2), 16) % 2 === 0;
      const firstStack = astraFirst ? 'publishing_v2_astra' : 'publishing_v2_gpt_control';
      const secondStack = astraFirst ? 'publishing_v2_gpt_control' : 'publishing_v2_astra';
      const first = await invokeArm(packet, firstStack);
      const pending = absent(secondStack, 'paired_arm_pending');
      const pair = { id: packet.id, kind: packet.kind, baseline: astraFirst ? pending : first, astra: astraFirst ? first : pending };
      slots[index] = pair;
      recordCost(first);
      // Persist every returned paid arm before starting its pair. Graceful aborts
      // stop scheduling but drain in-flight requests and preserve their receipts.
      await checkpoint();
      const blocked = schedulingBlock();
      const second = blocked ? absent(secondStack, blocked) : await invokeArm(packet, secondStack);
      if (astraFirst) pair.baseline = second; else pair.astra = second;
      recordCost(second);
      await checkpoint();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, packets.length) }, worker));
  await progressWrites;
  if (progressError !== undefined) throw progressError;
  return comparison;
}

export function blindedEvaluationCards(snapshot: FrozenEvaluationSnapshot, comparison: EvaluationComparison) {
  if (snapshot.hash !== comparison.snapshotHash) throw new Error('Comparison uses another snapshot.');
  const state = (arm: EvaluationArmResult) => arm.attempted === false ? 'not_attempted'
    : !arm.validPrimaryModels ? 'failed_or_invalid_execution' : arm.selected.length ? 'eligible_copy' : 'valid_gate_empty';
  return comparison.packets.map((entry) => {
    const packet = snapshot.packets.find((packet) => packet.id === entry.id)!;
    const astraIsA = parseInt(evaluationHash(`blind:${snapshot.hash}:${entry.id}`).slice(0, 2), 16) % 2 === 0;
    return { packetId: entry.id, kind: packet.kind, subject: packet.subject, calibrationSource: packet.calibrationSource,
      evidenceAsOf: snapshot.capturedAt,
      benchmarkKind: 'requested_topic_breadth_stress',
      referenceLimitations: packet.kind === 'geoffrey' ? snapshot.referenceSummary.limitation : null,
      evidence: packet.input.previewContext!.briefs.flatMap((brief) => brief.evidence),
      heldoutVoiceReferences: packet.kind === 'geoffrey' ? snapshot.heldoutExamples : [],
      A: (astraIsA ? entry.astra : entry.baseline).selected.map((candidate) => candidate.content),
      B: (astraIsA ? entry.baseline : entry.astra).selected.map((candidate) => candidate.content),
      AStatus: state(astraIsA ? entry.astra : entry.baseline),
      BStatus: state(astraIsA ? entry.baseline : entry.astra),
      votingInstruction: 'Only two eligible copies can yield a decisive copy-preference vote. A preference for eligible copy over a valid empty result is recorded separately as utility; failed execution is not an eligible empty result.',
    };
  });
}

export interface EvaluationVotes {
  snapshotHash: string;
  judge: { kind: 'human' | 'independent_critic'; id: string; model?: string };
  votes: Array<{ packetId: string; choice: 'A' | 'B' | 'tie' | 'neither'; reason?: string; editCharsA?: number | null; editCharsB?: number | null }>;
}
const FACTUAL_CODES = new Set(['claim_evidence', 'unsupported_operator_fact', 'source_attribution_dropped', 'copy_judge_factual_risk', 'unearned_authority', 'final_policy_safety_below_floor']);
const RESKIN_CODES = new Set(['voice_anchor_reskin', 'voice_anchor_semantic_reskin', 'copy_judge_anchor_reskin', 'recent_copy_duplicate', 'source_copy']);
const SLOP_CODES = new Set(['generated_writing_pattern', 'final_slop_risk', 'final_generated_pattern_risk', 'final_cringe_risk']);
export function scoreFrozenEvaluation(comparison: EvaluationComparison, votes: EvaluationVotes) {
  if (votes.snapshotHash !== comparison.snapshotHash) throw new Error('Votes use another snapshot.');
  if (!['human', 'independent_critic'].includes(votes.judge.kind) || !votes.judge.id?.trim()) throw new Error('Declare the human or independent critic responsible for votes.');
  if (votes.judge.kind === 'independent_critic' && (!votes.judge.model || ['gpt-6-astra', 'gpt-5.6', 'gpt-5.5'].some((primaryModel) => matchesEvaluationModel(primaryModel, votes.judge.model!)))) throw new Error('Declare a critic model independent of the compared writing/judging models.');
  const ids = new Set(comparison.packets.map((packet) => packet.id));
  if (new Set(votes.votes.map((vote) => vote.packetId)).size !== votes.votes.length || votes.votes.some((vote) => !ids.has(vote.packetId) || !['A', 'B', 'tie', 'neither'].includes(vote.choice))) throw new Error('Votes must be unique and refer to known packets.');
  const decisiveVotes: Array<{ packetId: string; astraWon: boolean }> = [];
  const utilityVotes: Array<{ packetId: string; astraWon: boolean }> = [];
  for (const vote of votes.votes) {
    if ([vote.editCharsA, vote.editCharsB].some((value) => value != null && (!Number.isFinite(value) || value < 0))) throw new Error('Edit-burden estimates must be nonnegative numbers or null.');
    if (vote.choice !== 'A' && vote.choice !== 'B') continue;
    const astraIsA = parseInt(evaluationHash(`blind:${comparison.snapshotHash}:${vote.packetId}`).slice(0, 2), 16) % 2 === 0;
    const packet = comparison.packets.find((packet) => packet.id === vote.packetId)!;
    if (!packet.astra.validPrimaryModels || !packet.baseline.validPrimaryModels) throw new Error(`A copy preference cannot treat failed or invalid execution as eligible content in ${vote.packetId}.`);
    const astraWon = (vote.choice === 'A') === astraIsA;
    if (packet.astra.selected.length === 0 || packet.baseline.selected.length === 0) {
      const preferred = astraWon ? packet.astra : packet.baseline;
      const other = astraWon ? packet.baseline : packet.astra;
      if (preferred.selected.length === 0 || other.selected.length > 0) throw new Error(`A decisive vote requires two nonempty eligible results in ${vote.packetId}; an empty result cannot win.`);
      utilityVotes.push({ packetId: vote.packetId, astraWon });
      continue;
    }
    decisiveVotes.push({ packetId: vote.packetId, astraWon });
  }
  const metrics = (arm: 'baseline' | 'astra', packets = comparison.packets) => {
    const runs = packets.map((packet) => packet[arm]);
    const costs = runs.filter((run) => run.attempted ?? Boolean(run.trace)).map(evaluationArmCost);
    const knownEstimatedCostUsd = costs.reduce((sum, cost) => sum + cost.knownEstimatedCostUsd, 0);
    const reservedUnknownCostUsd = costs.reduce((sum, cost) => sum + cost.reservedUnknownCostUsd, 0);
    const drafts = runs.flatMap((run) => run.drafts);
    const ideas = runs.flatMap((run) => run.ideas || []);
    const rate = (entries: Array<{ rejectionCodes: string[] }>, codes: Set<string>) => entries.length
      ? entries.filter((entry) => entry.rejectionCodes.some((code) => codes.has(code))).length / entries.length : null;
    const sumKnown = (values: Array<number | null | undefined>) => values.length && values.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
    const editEstimates = votes.votes.flatMap((vote) => {
      const packet = packets.find((packet) => packet.id === vote.packetId);
      if (!packet || !packet[arm].validPrimaryModels || packet[arm].selected.length === 0) return [];
      const astraIsA = parseInt(evaluationHash(`blind:${comparison.snapshotHash}:${vote.packetId}`).slice(0, 2), 16) % 2 === 0;
      const value = ((arm === 'astra') === astraIsA) ? vote.editCharsA : vote.editCharsB;
      return typeof value === 'number' ? [value] : [];
    });
    return { packets: packets.length, attemptedArms: runs.filter((run) => run.attempted ?? Boolean(run.trace)).length,
      invalidArms: runs.filter((run) => !run.validPrimaryModels).length,
      unknownCostArms: runs.filter((run) => (run.attempted ?? Boolean(run.trace)) && !hasKnownArmCost(run)).length,
      ideas: ideas.length, drafts: drafts.length, selected: runs.reduce((sum, run) => sum + run.selected.length, 0),
      qualifyingIdeaCount: runs.reduce((sum, run) => sum + new Set((run.ideas || [])
        .filter((idea) => idea.status === 'selected' || (idea.judgeScore != null && idea.rejectionCodes.every((code) => code === 'idea_not_selected')))
        .map((idea) => idea.semanticKey)).size, 0),
      totalDurationMs: sumKnown(runs.map((run) => run.trace?.durationMs)),
      estimatedCostUsd: runs.length && runs.every(hasKnownArmCost) ? knownEstimatedCostUsd : null,
      knownEstimatedCostUsd, reservedUnknownCostUsd, budgetMeasureUsd: knownEstimatedCostUsd + reservedUnknownCostUsd,
      reservedUnknownAttempts: costs.reduce((sum, cost) => sum + cost.reservedUnknownAttempts, 0),
      unreservedUnknownAttempts: costs.reduce((sum, cost) => sum + cost.unreservedUnknownAttempts, 0),
      estimatedEditCharacters: editEstimates.length ? editEstimates.reduce((sum, value) => sum + value, 0) / editEstimates.length : null,
      editEstimateCount: editEstimates.length,
      hardGateDenominators: { ideas: ideas.length, drafts: drafts.length },
      factualFailureRate: rate([...ideas, ...drafts], FACTUAL_CODES),
      ideaFactualFailureRate: rate(ideas, FACTUAL_CODES), draftFactualFailureRate: rate(drafts, FACTUAL_CODES),
      anchorReskinRate: rate([...ideas, ...drafts], RESKIN_CODES), slopFailureRate: rate([...ideas, ...drafts], SLOP_CODES),
      emptyRuns: runs.filter((run) => run.selected.length === 0).length,
      validGateEmptyRuns: runs.filter((run) => run.validPrimaryModels && run.selected.length === 0).length,
      selectedGateViolations: runs.flatMap((run) => run.selected).filter((candidate) => candidate.finalCriticVerdict !== 'allow').length,
    };
  };
  const baseline = metrics('baseline');
  const astra = metrics('astra');
  const validModels = comparison.packets.every((packet) => packet.baseline.validPrimaryModels && packet.astra.validPrimaryModels);
  const noIncrease = (value: number | null, control: number | null) => value === null || control === null
    ? value === null && control === null : value <= control;
  const noRegressionFor = (candidate: ReturnType<typeof metrics>, control: ReturnType<typeof metrics>) => (
    noIncrease(candidate.factualFailureRate, control.factualFailureRate)
    && noIncrease(candidate.ideaFactualFailureRate, control.ideaFactualFailureRate)
    && noIncrease(candidate.draftFactualFailureRate, control.draftFactualFailureRate)
    && noIncrease(candidate.anchorReskinRate, control.anchorReskinRate)
    && noIncrease(candidate.slopFailureRate, control.slopFailureRate)
    && candidate.emptyRuns <= control.emptyRuns && candidate.selectedGateViolations === 0
  );
  const noRegression = noRegressionFor(astra, baseline);
  const decisive = decisiveVotes.length;
  const astraWins = decisiveVotes.filter((vote) => vote.astraWon).length;
  const utilityFor = (packets: EvaluationComparison['packets']) => {
    const eligible = packets.filter((packet) => packet.astra.validPrimaryModels && packet.baseline.validPrimaryModels);
    const ids = new Set(packets.map((packet) => packet.id));
    return {
      astraAvailableOverValidEmpty: eligible.filter((packet) => packet.astra.selected.length > 0 && packet.baseline.selected.length === 0).length,
      baselineAvailableOverValidEmpty: eligible.filter((packet) => packet.baseline.selected.length > 0 && packet.astra.selected.length === 0).length,
      astraPreferred: utilityVotes.filter((vote) => ids.has(vote.packetId) && vote.astraWon).length,
      baselinePreferred: utilityVotes.filter((vote) => ids.has(vote.packetId) && !vote.astraWon).length,
      countsTowardDecisivePreference: false,
    };
  };
  const cohorts = Object.fromEntries((['geoffrey', 'synthetic_profile'] as const).map((kind) => {
    const packets = comparison.packets.filter((packet) => packet.kind === kind);
    const ids = new Set(packets.map((packet) => packet.id));
    const decisions = decisiveVotes.filter((vote) => ids.has(vote.packetId));
    const wins = decisions.filter((vote) => vote.astraWon).length;
    const baseline = metrics('baseline', packets), astra = metrics('astra', packets);
    return [kind, { packets: packets.length, decisive: decisions.length, astraWins: wins,
      winRate: decisions.length ? wins / decisions.length : null, baseline, astra,
      noRegression: noRegressionFor(astra, baseline), oneSidedUtility: utilityFor(packets) }];
  }));
  const winRate = decisive ? astraWins / decisive : null;
  const pass = comparison.completed && comparison.packets.length === 40 && votes.votes.length === 40
    && validModels && decisive >= 30 && winRate !== null && winRate >= 0.6 && noRegression;
  return { status: pass ? 'pass' : 'not_ready', judge: votes.judge, decisive, astraWins, winRate, validModels, noRegression, baseline, astra,
    attemptedCompletion: comparison.attemptedCompletion ?? comparison.completed, promotionValidCompletion: comparison.completed,
    cohorts, oneSidedUtility: utilityFor(comparison.packets), coverage: comparison.coverage || null,
    hardGateRateNotice: 'Rates include observed rejected ideas and drafts with separate factual denominators; null means no observations. Synthetic and Geoffrey results are reported separately.',
    editBurdenSource: votes.judge.kind === 'human' ? 'human_estimates_not_observed_edits' : 'critic_estimates_not_observed_edits',
    syntheticProfileNotice: 'Ten packets use synthetic calibration fixtures; they are not observed human voice or preference evidence.' };
}
