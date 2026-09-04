import { createHash } from 'node:crypto';
import {
  generateTweetBatchV2, buildGenerationBriefsV2, buildVoiceGuidanceV2, isV2VoiceReady,
  type GenerateTweetBatchV2Input, type GenerationBriefV2,
} from './generation-v2';
import { getModelChainForTask } from './ai';
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
  executionEnvironment?: { kind: 'remote'; origin: string; gitCommit: string };
}
export interface EvaluationComparison {
  version: string;
  snapshotHash: string;
  completed: boolean;
  estimatedCostUsd: number;
  packets: Array<{ id: string; kind: FrozenEvaluationPacket['kind']; baseline: EvaluationArmResult; astra: EvaluationArmResult }>;
}
export type EvaluationArmRunner = (packet: FrozenEvaluationPacket, stack: EvaluationArmResult['stack']) => Promise<EvaluationArmResult>;

export function validateFrozenEvaluationAge(capturedAt: string, now = new Date()): void {
  const age = now.getTime() - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age > 7 * 24 * 60 * 60 * 1000) throw new Error('Capture a fresh snapshot: comparison evidence is frozen as-of capture and expires after seven days.');
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
    const reportedMatchesPrimary = !reportedModel || Boolean(primary && (reportedModel === primary.model
      || (reportedModel.startsWith(`${primary.model}-`) && /^\d{4}-\d{2}-\d{2}$/.test(reportedModel.slice(primary.model.length + 1)))));
    return !primary || call.model !== primary.model || call.provider !== primary.provider || !reportedMatchesPrimary;
  });
  const successfulCalls = completedTrace?.modelCalls?.filter((call) => call.succeeded) || [];
  const invalidReason = failure || (!completedTrace ? 'missing_trace'
    : !['completed', 'empty'].includes(completedTrace.status) ? completedTrace.error || 'generation_failed'
    : invalidCalls.length ? 'provider_or_model_substitution'
    : successfulCalls.length === 0 ? 'no_successful_model_calls'
    : !Number.isFinite(completedTrace.estimatedCostUsd) ? 'unknown_evaluation_cost'
    : null);
  return { stack, selected, ideas, drafts, trace: completedTrace, validPrimaryModels: invalidReason === null, invalidReason };
}

export async function runFrozenEvaluation(snapshot: FrozenEvaluationSnapshot, options: {
  generate?: typeof generateTweetBatchV2;
  runArm?: EvaluationArmRunner;
  maxEstimatedCostUsd?: number;
  limit?: number;
  onProgress?: (comparison: EvaluationComparison) => void | Promise<void>;
  now?: Date;
} = {}): Promise<EvaluationComparison> {
  validateFrozenEvaluation(snapshot);
  validateFrozenEvaluationAge(snapshot.capturedAt, options.now);
  const runArm: EvaluationArmRunner = options.runArm || ((packet, stack) => runFrozenEvaluationArm(packet, stack, { generate: options.generate }));
  const budget = options.maxEstimatedCostUsd ?? 100;
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('A positive evaluation cost budget is required.');
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 40)) throw new Error('Evaluation limit must be an integer from 1 to 40.');
  const comparison: EvaluationComparison = { version: ASTRA_EVALUATION_VERSION, snapshotHash: snapshot.hash, completed: false, estimatedCostUsd: 0, packets: [] };
  for (const packet of snapshot.packets.slice(0, Math.max(1, Math.min(40, options.limit ?? 40)))) {
    if (comparison.estimatedCostUsd >= budget) break;
    // Alternate run order to avoid always measuring Astra after a warmed provider.
    const astraFirst = parseInt(evaluationHash(`${snapshot.hash}:${packet.id}`).slice(0, 2), 16) % 2 === 0;
    const firstStack = astraFirst ? 'publishing_v2_astra' : 'publishing_v2_gpt_control';
    const secondStack = astraFirst ? 'publishing_v2_gpt_control' : 'publishing_v2_astra';
    const absent = (stack: EvaluationArmResult['stack'], invalidReason: string): EvaluationArmResult => ({
      stack, selected: [], ideas: [], drafts: [], trace: null, validPrimaryModels: false, invalidReason,
    });
    const invokeArm = async (stack: EvaluationArmResult['stack']): Promise<EvaluationArmResult> => {
      try { return await runArm(packet, stack); }
      catch { return absent(stack, 'evaluation_arm_execution_failed_cost_unknown'); }
    };
    const first = await invokeArm(firstStack);
    const pending = absent(secondStack, 'paired_arm_pending');
    const pair = { id: packet.id, kind: packet.kind, baseline: astraFirst ? pending : first, astra: astraFirst ? first : pending };
    comparison.packets.push(pair);
    comparison.estimatedCostUsd += first.trace?.estimatedCostUsd || 0;
    // A completed paid arm remains reviewable even if the process or its paired
    // remote request terminates. Unknown remote costs never count as success.
    await options.onProgress?.(structuredClone(comparison));
    const budgetRemaining = comparison.estimatedCostUsd < budget;
    const second = first.validPrimaryModels && budgetRemaining
      ? await invokeArm(secondStack)
      : absent(secondStack, !budgetRemaining ? 'evaluation_cost_budget_reached' : 'paired_run_aborted_after_invalid_arm');
    if (astraFirst) pair.baseline = second; else pair.astra = second;
    comparison.estimatedCostUsd += second.trace?.estimatedCostUsd || 0;
    comparison.completed = comparison.packets.length === 40 && comparison.packets.every((entry) => entry.baseline.validPrimaryModels && entry.astra.validPrimaryModels);
    await options.onProgress?.(structuredClone(comparison));
    if (!first.validPrimaryModels || !second.validPrimaryModels) break;
  }
  return comparison;
}

export function blindedEvaluationCards(snapshot: FrozenEvaluationSnapshot, comparison: EvaluationComparison) {
  if (snapshot.hash !== comparison.snapshotHash) throw new Error('Comparison uses another snapshot.');
  return comparison.packets.map((entry) => {
    const packet = snapshot.packets.find((packet) => packet.id === entry.id)!;
    const astraIsA = parseInt(evaluationHash(`blind:${snapshot.hash}:${entry.id}`).slice(0, 2), 16) % 2 === 0;
    return { packetId: entry.id, kind: packet.kind, subject: packet.subject, calibrationSource: packet.calibrationSource,
      evidenceAsOf: snapshot.capturedAt,
      referenceLimitations: packet.kind === 'geoffrey' ? snapshot.referenceSummary.limitation : null,
      evidence: packet.input.previewContext!.briefs.flatMap((brief) => brief.evidence),
      heldoutVoiceReferences: packet.kind === 'geoffrey' ? snapshot.heldoutExamples : [],
      A: (astraIsA ? entry.astra : entry.baseline).selected.map((candidate) => candidate.content),
      B: (astraIsA ? entry.baseline : entry.astra).selected.map((candidate) => candidate.content),
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
  if (votes.judge.kind === 'independent_critic' && (!votes.judge.model || ['gpt-6-astra', 'gpt-5.6', 'gpt-5.5'].includes(votes.judge.model))) throw new Error('Declare a critic model independent of the compared writing/judging models.');
  const ids = new Set(comparison.packets.map((packet) => packet.id));
  if (new Set(votes.votes.map((vote) => vote.packetId)).size !== votes.votes.length || votes.votes.some((vote) => !ids.has(vote.packetId) || !['A', 'B', 'tie', 'neither'].includes(vote.choice))) throw new Error('Votes must be unique and refer to known packets.');
  let decisive = 0;
  let astraWins = 0;
  for (const vote of votes.votes) {
    if ([vote.editCharsA, vote.editCharsB].some((value) => value != null && (!Number.isFinite(value) || value < 0))) throw new Error('Edit-burden estimates must be nonnegative numbers or null.');
    if (vote.choice !== 'A' && vote.choice !== 'B') continue;
    decisive += 1;
    const astraIsA = parseInt(evaluationHash(`blind:${comparison.snapshotHash}:${vote.packetId}`).slice(0, 2), 16) % 2 === 0;
    const packet = comparison.packets.find((packet) => packet.id === vote.packetId)!;
    if (packet.astra.selected.length === 0 || packet.baseline.selected.length === 0) throw new Error(`A decisive vote requires two nonempty eligible results in ${vote.packetId}; use tie or neither for empty pairs.`);
    if ((vote.choice === 'A') === astraIsA) astraWins += 1;
  }
  const metrics = (arm: 'baseline' | 'astra') => {
    const runs = comparison.packets.map((packet) => packet[arm]);
    const drafts = runs.flatMap((run) => run.drafts);
    const rate = (codes: Set<string>) => drafts.length ? drafts.filter((draft) => draft.rejectionCodes.some((code) => codes.has(code))).length / drafts.length : 0;
    const sumKnown = (values: Array<number | null | undefined>) => values.length && values.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
    const editEstimates = votes.votes.flatMap((vote) => {
      const astraIsA = parseInt(evaluationHash(`blind:${comparison.snapshotHash}:${vote.packetId}`).slice(0, 2), 16) % 2 === 0;
      const value = ((arm === 'astra') === astraIsA) ? vote.editCharsA : vote.editCharsB;
      return typeof value === 'number' ? [value] : [];
    });
    return { drafts: drafts.length, selected: runs.reduce((sum, run) => sum + run.selected.length, 0),
      qualifyingIdeaCount: runs.reduce((sum, run) => sum + new Set((run.ideas || [])
        .filter((idea) => idea.status === 'selected' || (idea.judgeScore != null && idea.rejectionCodes.every((code) => code === 'idea_not_selected')))
        .map((idea) => idea.semanticKey)).size, 0),
      totalDurationMs: sumKnown(runs.map((run) => run.trace?.durationMs)),
      estimatedCostUsd: sumKnown(runs.map((run) => run.trace?.estimatedCostUsd)),
      estimatedEditCharacters: editEstimates.length ? editEstimates.reduce((sum, value) => sum + value, 0) / editEstimates.length : null,
      editEstimateCount: editEstimates.length,
      factualFailureRate: rate(FACTUAL_CODES), anchorReskinRate: rate(RESKIN_CODES), slopFailureRate: rate(SLOP_CODES),
      emptyRuns: runs.filter((run) => run.selected.length === 0).length,
      selectedGateViolations: runs.flatMap((run) => run.selected).filter((candidate) => candidate.finalCriticVerdict !== 'allow').length,
    };
  };
  const baseline = metrics('baseline');
  const astra = metrics('astra');
  const validModels = comparison.packets.every((packet) => packet.baseline.validPrimaryModels && packet.astra.validPrimaryModels);
  const noRegression = astra.factualFailureRate <= baseline.factualFailureRate && astra.anchorReskinRate <= baseline.anchorReskinRate
    && astra.slopFailureRate <= baseline.slopFailureRate && astra.emptyRuns <= baseline.emptyRuns && astra.selectedGateViolations === 0;
  const winRate = decisive ? astraWins / decisive : null;
  const pass = comparison.completed && comparison.packets.length === 40 && votes.votes.length === 40
    && validModels && decisive >= 30 && winRate !== null && winRate >= 0.6 && noRegression;
  return { status: pass ? 'pass' : 'not_ready', judge: votes.judge, decisive, astraWins, winRate, validModels, noRegression, baseline, astra,
    editBurdenSource: votes.judge.kind === 'human' ? 'human_estimates_not_observed_edits' : 'critic_estimates_not_observed_edits',
    syntheticProfileNotice: 'Ten packets use synthetic calibration fixtures; they are not observed human voice or preference evidence.' };
}
