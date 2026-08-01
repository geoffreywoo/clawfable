import { generateText, hasTextGenerationProvider } from './ai';
import type { AccountAnalysis } from './types';
import type { VoiceProfile } from './soul-parser';
import type { AgentLearnings, CandidateFeatureTags, CandidateJudgeBreakdown, PersonalizationMemory } from './types';
import type { RankableProtocolTweet } from './candidate-ranking';
import { buildCoverageCluster, extractCandidateFeatureTags } from './tweet-features';
import { assessTechnicalElevation, scoreSlopRisk } from './virality-signals';
import {
  assessAccountTaste,
  buildGeoffreyNativeGenerationBrief,
  buildGeoffreyNativeWritingBrief,
  isGeoffreyVoiceProfile,
} from './account-taste';
import { getTrustedClaimSourceTexts, getUntrustedSourceTexts } from './source-trust';

type JudgeContext = {
  voiceProfile?: VoiceProfile;
  analysis?: AccountAnalysis;
  learnings?: AgentLearnings | null;
  memory?: PersonalizationMemory | null;
};

export type CandidateJudgeMode = 'model' | 'heuristic';
export const FINAL_CRITIC_VERSION = 'geoffwoo-final-critic-v1';
const JUDGE_CANDIDATE_CONTENT_LIMIT = 1200;
const MUTATION_CANDIDATE_CONTENT_LIMIT = 1000;
const MUTATION_CRITIC_NOTE_LIMIT = 220;

export function formatCandidateContentForJudgePrompt(content: string): string {
  if (content.length <= JUDGE_CANDIDATE_CONTENT_LIMIT) return content;
  return `${content.slice(0, JUDGE_CANDIDATE_CONTENT_LIMIT).trimEnd()}\n[trimmed for critic; full draft is used by ranking and output]`;
}

export function formatMutationCandidateForPrompt(candidate: JudgedCandidate, idx: number): string {
  const content = candidate.content.length <= MUTATION_CANDIDATE_CONTENT_LIMIT
    ? candidate.content
    : `${candidate.content.slice(0, MUTATION_CANDIDATE_CONTENT_LIMIT).trimEnd()}\n[trimmed for mutation; preserve the core thesis]`;
  const notes = candidate.judgeNotes.length <= MUTATION_CRITIC_NOTE_LIMIT
    ? candidate.judgeNotes
    : `${candidate.judgeNotes.slice(0, MUTATION_CRITIC_NOTE_LIMIT).trimEnd()}...`;
  const source = candidate.sourceBrief
    ? `\nsource=${candidate.sourceBrief.slice(0, 320)}`
    : '';
  return `[${idx}] format=${candidate.format} topic=${candidate.targetTopic}${source}\ncontent=${content}\ncritic=${notes}`;
}

export function getMutationMaxTokens(targetCount: number): number {
  if (targetCount <= 2) return 1024;
  if (targetCount === 3) return 1536;
  if (targetCount <= 4) return 2048;
  return 3072;
}

export function getGeoffreyMutationMaxTokens(targetCount: number): number {
  return Math.min(8192, Math.max(4096, getMutationMaxTokens(targetCount) * 3));
}

function formatNativeAnchorForPrompt(content: string): string {
  return content
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+$/gm, '')
    .trim()
    .slice(0, 320);
}

export function getBulkJudgeMaxTokens(candidateCount: number): number {
  if (candidateCount <= 4) return 1024;
  if (candidateCount <= 8) return 2048;
  if (candidateCount <= 12) return 3072;
  return 4096;
}

export function extractModelJsonRecords(text: string): Record<string, unknown>[] {
  const cleaned = text
    .split('\n')
    .filter((line) => !/^\s*```(?:json)?\s*$/i.test(line))
    .join('\n')
    .trim();
  if (!cleaned) return [];

  const asRecords = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if ('idx' in record || 'candidate' in record || 'index' in record) return [record];
    if (
      'overall' in record
      || 'voiceFit' in record
      || 'nativeVoice' in record
      || 'content' in record
    ) return [record];
    for (const key of ['judgments', 'scores', 'results', 'candidates']) {
      const nested = asRecords(record[key]);
      if (nested.length > 0) return nested;
    }
    const indexed = Object.entries(record).flatMap(([key, item]) => {
      if (!/^\d+$/.test(key) || !item || typeof item !== 'object') return [];
      const itemRecord = item as Record<string, unknown>;
      return [{ idx: Number(key), ...itemRecord }];
    });
    return indexed;
  };

  try {
    const records = asRecords(JSON.parse(cleaned));
    if (records.length > 0) return records;
  } catch {
    // Fall through to newline-delimited JSON.
  }

  return cleaned.split('\n').flatMap((line) => {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed.startsWith('{')) return [];
    try {
      return asRecords(JSON.parse(trimmed));
    } catch {
      return [];
    }
  });
}

export interface JudgedCandidate extends RankableProtocolTweet {
  featureTags: CandidateFeatureTags;
  coverageCluster: string;
  judgeScore: number;
  judgeBreakdown: CandidateJudgeBreakdown;
  judgeNotes: string;
}

export interface CandidateJudgeDiagnostics {
  task?: 'bulk_judgment' | 'final_judgment';
  requested?: number;
  mode?: CandidateJudgeMode;
  requireModel?: boolean;
  provider?: 'openai' | 'anthropic' | null;
  model?: string | null;
  stopReason?: string | null;
  responseLength?: number;
  responsePreview?: string;
  parsed?: number;
  exitReason?: string;
  error?: string;
}

export function mergeCandidateVersionsForRanking(
  baseCandidates: JudgedCandidate[],
  dictionEdits: JudgedCandidate[],
  voiceProfile: VoiceProfile,
): JudgedCandidate[] {
  if (!isGeoffreyVoiceProfile(voiceProfile) || dictionEdits.length === 0) {
    return [...baseCandidates, ...dictionEdits];
  }

  const editedExperimentIds = new Set(
    dictionEdits
      .map((candidate) => candidate.draftExperimentId)
      .filter((id): id is string => Boolean(id)),
  );
  return [
    ...baseCandidates.filter((candidate) => (
      !candidate.draftExperimentId || !editedExperimentIds.has(candidate.draftExperimentId)
    )),
    ...dictionEdits,
  ];
}

export function selectMutationTargets(
  candidates: JudgedCandidate[],
  voiceProfile: VoiceProfile,
): JudgedCandidate[] {
  const geoffreyStrict = isGeoffreyVoiceProfile(voiceProfile);
  const mutationLimit = geoffreyStrict ? 4 : 4;
  const ranked = [...candidates]
    .filter((candidate) => (candidate.judgeScore || 0) >= 0.48)
    .sort((a, b) => {
      if (geoffreyStrict) {
        const aGrounded = Number(Boolean(a.sourceBrief || a.trendHeadline || a.trendTopicId));
        const bGrounded = Number(Boolean(b.sourceBrief || b.trendHeadline || b.trendTopicId));
        if (aGrounded !== bGrounded) return bGrounded - aGrounded;
        const aVoice = (a.judgeBreakdown.nativeVoice ?? a.judgeBreakdown.voiceFit)
          + (a.judgeBreakdown.casualStartupFit ?? 0.5) * 0.35
          - (a.judgeBreakdown.stiffnessRisk ?? 0) * 0.3
          - (a.judgeBreakdown.cringeRisk ?? 0) * 0.25;
        const bVoice = (b.judgeBreakdown.nativeVoice ?? b.judgeBreakdown.voiceFit)
          + (b.judgeBreakdown.casualStartupFit ?? 0.5) * 0.35
          - (b.judgeBreakdown.stiffnessRisk ?? 0) * 0.3
          - (b.judgeBreakdown.cringeRisk ?? 0) * 0.25;
        if (aVoice !== bVoice) return bVoice - aVoice;
      }
      return (b.judgeScore || 0) - (a.judgeScore || 0);
    });
  if (!geoffreyStrict) return ranked.slice(0, Math.min(mutationLimit, candidates.length));

  const selected: JudgedCandidate[] = [];
  const seenBriefs = new Set<string>();
  for (const candidate of ranked) {
    const brief = String(
      candidate.trendTopicId
      || candidate.sourceBrief
      || candidate.trendHeadline
      || candidate.targetTopic
      || candidate.draftExperimentId
      || candidate.content,
    ).trim().toLowerCase();
    if (seenBriefs.has(brief)) continue;
    seenBriefs.add(brief);
    selected.push(candidate);
    if (selected.length >= mutationLimit) break;
  }
  return selected;
}

export function selectGeoffreyVoiceRescueTargets(
  candidates: JudgedCandidate[],
  voiceProfile: VoiceProfile,
): JudgedCandidate[] {
  if (!isGeoffreyVoiceProfile(voiceProfile)) return [];

  const eligible = [...candidates]
    .filter((candidate) => {
      const breakdown = candidate.judgeBreakdown;
      const needsRescue = candidate.finalCriticVerdict !== 'allow'
        || (breakdown.nativeVoice ?? breakdown.voiceFit) < 0.65
        || (breakdown.casualStartupFit ?? 0.5) < 0.58
        || (breakdown.stiffnessRisk ?? 0) >= 0.3
        || (breakdown.cringeRisk ?? 0) >= 0.32
        || (breakdown.manualAnchorReskinRisk ?? 0) >= 0.25;
      return (candidate.mutationRound ?? 0) >= 1
        && Boolean(candidate.sourceBrief || candidate.trendHeadline || candidate.trendTopicId)
        && candidate.judgeScore >= 0.48
        && breakdown.policySafety >= 0.55
        && (breakdown.nativeVoice ?? breakdown.voiceFit) >= 0.55
        && needsRescue;
    })
    .sort((a, b) => (
      (b.judgeBreakdown.casualStartupFit ?? 0) - (a.judgeBreakdown.casualStartupFit ?? 0)
      || (a.judgeBreakdown.stiffnessRisk ?? 0) - (b.judgeBreakdown.stiffnessRisk ?? 0)
      || (a.judgeBreakdown.cringeRisk ?? 0) - (b.judgeBreakdown.cringeRisk ?? 0)
      || b.judgeScore - a.judgeScore
    ));
  const seenExperiments = new Set<string>();
  const selected: JudgedCandidate[] = [];

  for (const candidate of eligible) {
    const experimentKey = candidate.draftExperimentId || candidate.sourceBrief || candidate.content;
    if (seenExperiments.has(experimentKey)) continue;
    seenExperiments.add(experimentKey);
    selected.push(candidate);
    if (selected.length === 4) break;
  }

  return selected;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeForSearch(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[_-]/g, ' ');
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  const normalized = normalizeForSearch(text);
  return terms.some((term) => normalized.includes(term));
}

function contextText(items: Array<string | null | undefined>): string {
  return items.filter((item): item is string => Boolean(item?.trim())).join(' ');
}

function scoreContextualMemoryFit(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: JudgeContext,
): { boost: number; penalty: number; notes: string[] } {
  const memory = context.memory;
  const notes: string[] = [];
  if (!memory) return { boost: 0, penalty: 0, notes };

  const reinforce = contextText([
    ...(memory.alwaysDoMoreOfThis || []),
    ...(memory.operatorHiddenPreferences || []),
    ...(memory.editTransformations || []),
    ...(memory.conversationInsights || []),
    ...(memory.promptStrategyLessons || []),
  ]);
  const avoid = contextText([
    ...(memory.neverDoThisAgain || []),
    ...(memory.identityConstraints || []),
    ...(memory.outcomeFatigueLessons || []),
  ]);

  let boost = 0;
  let penalty = 0;
  const hasSpecificity = ['concrete', 'data_driven', 'tactical', 'story_led'].includes(featureTags.specificity)
    || /\b\d+[%x]?\b|\b(example|specific|because|mechanism|proof)\b/i.test(candidate.content);
  const hasReadableStructure = candidate.content.split('\n').filter((line) => line.trim()).length >= 2
    || ['stacked_lines', 'list', 'comparison', 'argument'].includes(featureTags.structure);
  const hasConversationSubstance = /\b(reply|question|conversation|debate|disagree|why|because)\b/i.test(candidate.content)
    && candidate.content.length >= 80;

  if (hasAnyTerm(reinforce, ['specific', 'specificity', 'numbers', 'data', 'evidence', 'example', 'concrete', 'mechanism', 'proof']) && hasSpecificity) {
    boost += 0.08;
    notes.push('memory-aligned specificity');
  }

  if (hasAnyTerm(reinforce, ['line break', 'structure', 'readability', 'clearer build']) && hasReadableStructure) {
    boost += 0.05;
    notes.push('memory-aligned structure');
  }

  if (hasAnyTerm(reinforce, ['reply', 'conversation', 'substance', 'real substance']) && hasConversationSubstance) {
    boost += 0.04;
    notes.push('memory-aligned conversation value');
  }

  if (
    hasAnyTerm(avoid, ['generic', 'vague', 'abstract', 'thin', 'surface level', 'surface-level'])
    && (featureTags.specificity === 'abstract' || featureTags.riskFlags.includes('thin') || candidate.content.length < 70)
  ) {
    penalty += 0.1;
    notes.push('memory conflict: generic');
  }

  if (
    hasAnyTerm(avoid, ['hype', 'buzzword', 'salesy', 'promotional', 'cta', 'call to action', 'subscribe', 'dm me'])
    && (featureTags.riskFlags.includes('salesy') || /\b(unlock|10x|viral|subscribe|dm me|sign up|buy now)\b/i.test(candidate.content))
  ) {
    penalty += 0.12;
    notes.push('memory conflict: promotional');
  }

  return {
    boost: clamp(boost, 0, 0.18),
    penalty: clamp(penalty, 0, 0.22),
    notes,
  };
}

function scoreContextualVoiceFit(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: JudgeContext,
): number {
  let score = candidate.targetTopic ? 0.72 : 0.58;
  const normalizedTopic = normalizeForSearch(candidate.targetTopic);

  if (context.voiceProfile?.topics.some((topic) => normalizeForSearch(topic) === normalizedTopic)) {
    score += 0.08;
  }

  if (context.learnings?.styleFingerprint?.topHooks.some((hook) => normalizeForSearch(hook) === normalizeForSearch(featureTags.hook))) {
    score += 0.04;
  }

  if (context.learnings?.styleFingerprint?.topTones.some((tone) => normalizeForSearch(tone) === normalizeForSearch(featureTags.tone))) {
    score += 0.04;
  }

  const antiGoals = context.voiceProfile?.antiGoals || [];
  if (antiGoals.some((goal) => goal.length > 4 && normalizeForSearch(candidate.content).includes(normalizeForSearch(goal)))) {
    score -= 0.18;
  }

  const memoryFit = scoreContextualMemoryFit(candidate, featureTags, context);
  score += memoryFit.boost * 0.8;
  score -= memoryFit.penalty;

  return clamp(score, 0.34, 0.9);
}

function heuristicJudge(candidate: RankableProtocolTweet, context: JudgeContext = {}): JudgedCandidate {
  const featureTags = candidate.featureTags || extractCandidateFeatureTags(candidate.content, {
    topic: candidate.targetTopic,
  });
  const memoryFit = scoreContextualMemoryFit(candidate, featureTags, context);
  const slopRisk = scoreSlopRisk(candidate.content, featureTags);
  const technicalElevation = assessTechnicalElevation(candidate.content);
  const accountTaste = assessAccountTaste(candidate.content, {
    voiceProfile: context.voiceProfile,
    learnings: context.learnings,
    memory: context.memory,
    featureTags,
    sourceTexts: getTrustedClaimSourceTexts(candidate, [
      ...(context.learnings?.operatorVoiceReference?.pinnedExamples || []).map((entry) => entry.content),
      ...(context.learnings?.operatorVoiceReference?.startupRegisterExamples || []).map((entry) => entry.content),
      ...(context.learnings?.operatorVoiceReference?.bestPerformers || []).map((entry) => entry.content),
    ]),
    untrustedSourceTexts: getUntrustedSourceTexts(candidate),
  });
  const clarity = clamp(candidate.content.length >= 60 && candidate.content.length <= 900 ? 0.72 : 0.55);
  const technicalBoost = technicalElevation.technicalScore * 0.5;
  const banalPenalty = technicalElevation.banalOpsScore * 0.65;
  const novelty = clamp(
    (featureTags.riskFlags.includes('thin') ? 0.48 : 0.68)
    - (slopRisk >= 0.45 ? 0.14 : 0)
    + technicalBoost
    + accountTaste.technicalCredibilityScore * 0.22
    - banalPenalty
    - accountTaste.genericAccountFitRisk * 0.22
  );
  const audienceFit = clamp(
    (/\b(founder|operator|builder|market|product|ai|startup)\b/i.test(candidate.content) ? 0.72 : 0.58)
    + (memoryFit.notes.includes('memory-aligned conversation value') ? 0.04 : 0)
    + technicalElevation.technicalScore * 0.35
    + accountTaste.technicalCredibilityScore * 0.22
    - technicalElevation.banalOpsScore * 0.45
    - accountTaste.statusTextureRisk * 0.3
  );
  const policySafety = clamp(
    1
    - (featureTags.riskFlags.length * 0.12)
    - (memoryFit.penalty * 0.5)
    - (slopRisk * 0.18)
    - (accountTaste.cringeRisk * 0.18)
    - (accountTaste.truthfulnessRisk * 0.6)
    - (accountTaste.sourceCopyRisk * 0.7)
    + (memoryFit.boost * 0.25),
    0.32,
    0.9,
  );
  const voiceFit = clamp(
    scoreContextualVoiceFit(candidate, featureTags, context)
    - (slopRisk >= 0.5 ? 0.12 : slopRisk * 0.08)
    + accountTaste.nativeVoiceScore * 0.24
    + technicalElevation.technicalScore * 0.25
    - technicalElevation.banalOpsScore * 0.55
    - accountTaste.truthfulnessRisk * 0.45
    - accountTaste.sourceCopyRisk * 0.55
    - accountTaste.generatedPatternRisk * 0.18,
    0.34,
    0.9,
  );
  const overall = clamp(
    voiceFit * 0.28 +
    clamp(clarity + (memoryFit.notes.includes('memory-aligned structure') ? 0.04 : 0)) * 0.18 +
    clamp(novelty + memoryFit.boost - memoryFit.penalty) * 0.18 +
    audienceFit * 0.2 +
    policySafety * 0.16
  );
  const memoryNote = memoryFit.notes.length > 0 ? ` ${memoryFit.notes.slice(0, 2).join('; ')}.` : '';
  const slopNote = slopRisk >= 0.45 ? ` Slop risk ${slopRisk.toFixed(2)}: too generated/formulaic.` : '';
  const tasteNote = accountTaste.notes.length > 0
    ? ` Native taste: ${accountTaste.notes.slice(0, 2).join('; ')}.`
    : '';
  const registerNote = isGeoffreyVoiceProfile(context.voiceProfile)
    && accountTaste.casualStartupScore < 0.6
    ? ` Casual startup diction ${accountTaste.casualStartupScore.toFixed(2)}: still too neutral or formal for Geoffrey.`
    : '';
  const elevationNote = technicalElevation.hasBanalOpsTexture && !technicalElevation.hasHardTechAnchor
    ? ' Low-status ops texture: needs a harder technical/industrial anchor.'
    : technicalElevation.hasHardTechAnchor
      ? ' Technical anchor present.'
      : '';

  const judgeBreakdown: CandidateJudgeBreakdown = {
    overall: Number(overall.toFixed(3)),
    voiceFit: Number(voiceFit.toFixed(3)),
    clarity: Number(clarity.toFixed(3)),
    novelty: Number(novelty.toFixed(3)),
    audienceFit: Number(audienceFit.toFixed(3)),
    policySafety: Number(policySafety.toFixed(3)),
    nativeVoice: accountTaste.nativeVoiceScore,
    casualStartupFit: accountTaste.casualStartupScore,
    stiffnessRisk: accountTaste.stiffnessRisk,
    cringeRisk: accountTaste.cringeRisk,
    technicalCredibility: accountTaste.technicalCredibilityScore,
  };
  return {
    ...candidate,
    featureTags,
    coverageCluster: candidate.coverageCluster || buildCoverageCluster(candidate.content, candidate.targetTopic, featureTags.thesis),
    judgeScore: Number(overall.toFixed(3)),
    judgeBreakdown,
    judgeNotes: `Heuristic critic: ${featureTags.hook.replace(/_/g, ' ')} hook, ${featureTags.structure.replace(/_/g, ' ')} structure, ${featureTags.specificity.replace(/_/g, ' ')} specificity.${memoryNote}${slopNote}${elevationNote}${tasteNote}${registerNote}`,
    judgeProvider: candidate.judgeProvider ?? null,
    judgeModel: candidate.judgeModel ?? null,
    finalCriticProvider: candidate.finalCriticProvider ?? null,
    finalCriticModel: candidate.finalCriticModel ?? null,
    finalCriticVerdict: candidate.finalCriticVerdict ?? null,
    finalCriticScores: candidate.finalCriticScores ?? null,
    finalCriticVersion: candidate.finalCriticVersion ?? null,
  };
}

function finalCriticVerdict(
  breakdown: CandidateJudgeBreakdown,
  geoffreyStrict: boolean,
): 'allow' | 'review' | 'block' {
  if (!geoffreyStrict) {
    if (breakdown.policySafety < 0.5 || breakdown.overall < 0.42) return 'block';
    return breakdown.overall >= 0.58 && breakdown.voiceFit >= 0.55 ? 'allow' : 'review';
  }
  if (
    breakdown.policySafety < 0.58
    || (breakdown.nativeVoice ?? breakdown.voiceFit) < 0.5
    || (breakdown.cringeRisk ?? 0.5) >= 0.5
    || (breakdown.stiffnessRisk ?? 0.5) >= 0.5
  ) return 'block';
  return (
    breakdown.overall >= 0.58
    && (breakdown.nativeVoice ?? breakdown.voiceFit) >= 0.65
    && (breakdown.casualStartupFit ?? 0) >= 0.58
    && (breakdown.cringeRisk ?? 1) < 0.32
    && (breakdown.stiffnessRisk ?? 1) < 0.3
    && (breakdown.manualAnchorReskinRisk ?? 0) < 0.25
  ) ? 'allow' : 'review';
}

function parseScoredLines(
  text: string,
  candidates: RankableProtocolTweet[],
  context: JudgeContext,
  generation: { provider: 'openai' | 'anthropic'; model: string },
  requireModel: boolean,
  task: 'bulk_judgment' | 'final_judgment',
): JudgedCandidate[] {
  const judged = new Map<number, JudgedCandidate>();

  const records = extractModelJsonRecords(text);
  for (const [recordIndex, parsed] of records.entries()) {
    try {
      const explicitIndex = parsed.idx ?? parsed.candidate ?? parsed.index;
      const idx = explicitIndex === undefined || explicitIndex === null
        ? recordIndex
        : Number(explicitIndex);
      const candidate = candidates[idx];
      if (!candidate) continue;
      const parsedThesis = typeof parsed.thesis === 'string' ? parsed.thesis : null;
      const featureTags = extractCandidateFeatureTags(candidate.content, {
        topic: candidate.targetTopic,
        thesisHint: parsedThesis,
      });
      const geoffreyStrict = isGeoffreyVoiceProfile(context.voiceProfile);
      const rawVoiceFit = clamp(Number(parsed.voiceFit) || 0.5);
      const modelNativeVoice = Number.isFinite(Number(parsed.nativeVoice))
        ? clamp(Number(parsed.nativeVoice))
        : rawVoiceFit;
      const modelCringeRisk = Number.isFinite(Number(parsed.cringeRisk))
        ? clamp(Number(parsed.cringeRisk))
        : 0.5;
      const modelCasualStartupFit = Number.isFinite(Number(parsed.casualStartupFit))
        ? clamp(Number(parsed.casualStartupFit))
        : modelNativeVoice;
      const modelStiffnessRisk = Number.isFinite(Number(parsed.stiffnessRisk))
        ? clamp(Number(parsed.stiffnessRisk))
        : clamp(modelCringeRisk * 0.5);
      const modelTechnicalCredibility = Number.isFinite(Number(parsed.technicalCredibility))
        ? clamp(Number(parsed.technicalCredibility))
        : 0.5;
      const modelManualAnchorReskinRisk = Number.isFinite(Number(parsed.manualAnchorReskinRisk))
        ? clamp(Number(parsed.manualAnchorReskinRisk))
        : 0;
      const voiceFit = geoffreyStrict
        ? clamp(
            rawVoiceFit * 0.35
            + modelNativeVoice * 0.48
            + modelCasualStartupFit * 0.17
            - modelCringeRisk * 0.22
            - modelStiffnessRisk * 0.24
            - modelManualAnchorReskinRisk * 0.28,
          )
        : rawVoiceFit;
      let overall = clamp(Number(parsed.overall) || 0.5);
      if (geoffreyStrict) {
        overall = clamp(
          overall * 0.55
          + voiceFit * 0.24
          + modelTechnicalCredibility * 0.13
          + modelCasualStartupFit * 0.08
          - modelCringeRisk * 0.2
          - modelStiffnessRisk * 0.22
          - modelManualAnchorReskinRisk * 0.24,
        );
        if (
          modelNativeVoice < 0.55
          || modelCasualStartupFit < 0.5
          || modelStiffnessRisk >= 0.5
          || modelCringeRisk >= 0.5
          || modelManualAnchorReskinRisk >= 0.48
        ) {
          overall = Math.min(overall, 0.45);
        }
      }
      const judgeBreakdown: CandidateJudgeBreakdown = {
        overall,
        voiceFit,
        clarity: clamp(Number(parsed.clarity) || 0.5),
        novelty: clamp(Number(parsed.novelty) || 0.5),
        audienceFit: clamp(Number(parsed.audienceFit) || 0.5),
        policySafety: clamp(Number(parsed.policySafety) || 0.5),
        nativeVoice: modelNativeVoice,
        casualStartupFit: modelCasualStartupFit,
        stiffnessRisk: modelStiffnessRisk,
        cringeRisk: modelCringeRisk,
        technicalCredibility: modelTechnicalCredibility,
        manualAnchorReskinRisk: modelManualAnchorReskinRisk,
      };
      const isFinalCritic = task === 'final_judgment';
      judged.set(idx, {
        ...candidate,
        featureTags,
        coverageCluster: buildCoverageCluster(candidate.content, candidate.targetTopic, parsedThesis || featureTags.thesis),
        judgeScore: isFinalCritic && candidate.judgeScore !== null && candidate.judgeScore !== undefined
          ? candidate.judgeScore
          : Number(judgeBreakdown.overall.toFixed(3)),
        judgeBreakdown: isFinalCritic && candidate.judgeBreakdown
          ? candidate.judgeBreakdown
          : judgeBreakdown,
        judgeNotes: typeof parsed.notes === 'string'
          ? `${parsed.notes.trim()}${geoffreyStrict ? ` Native=${modelNativeVoice.toFixed(2)} casualStartup=${modelCasualStartupFit.toFixed(2)} stiffness=${modelStiffnessRisk.toFixed(2)} cringe=${modelCringeRisk.toFixed(2)} technical=${modelTechnicalCredibility.toFixed(2)} anchorReskin=${modelManualAnchorReskinRisk.toFixed(2)}.` : ''}`
          : '',
        judgeProvider: isFinalCritic ? candidate.judgeProvider ?? null : generation.provider,
        judgeModel: isFinalCritic ? candidate.judgeModel ?? null : generation.model,
        finalCriticProvider: isFinalCritic ? generation.provider : candidate.finalCriticProvider ?? null,
        finalCriticModel: isFinalCritic ? generation.model : candidate.finalCriticModel ?? null,
        finalCriticVerdict: isFinalCritic
          ? finalCriticVerdict(judgeBreakdown, geoffreyStrict)
          : candidate.finalCriticVerdict ?? null,
        finalCriticScores: isFinalCritic ? judgeBreakdown : candidate.finalCriticScores ?? null,
        finalCriticVersion: isFinalCritic ? FINAL_CRITIC_VERSION : candidate.finalCriticVersion ?? null,
      });
    } catch {
      // Skip malformed lines.
    }
  }

  return candidates
    .map((candidate, idx) => judged.get(idx) || (requireModel ? null : heuristicJudge(candidate, context)))
    .filter((candidate): candidate is JudgedCandidate => candidate !== null);
}

export async function judgeCandidates(
  candidates: RankableProtocolTweet[],
  {
    voiceProfile,
    analysis,
    learnings,
    memory,
    mode = 'model',
    requireModel = false,
    task = 'bulk_judgment',
    diagnostics,
  }: {
    voiceProfile: VoiceProfile;
    analysis: AccountAnalysis;
    learnings: AgentLearnings | null;
    memory: PersonalizationMemory | null;
    mode?: CandidateJudgeMode;
    requireModel?: boolean;
    task?: 'bulk_judgment' | 'final_judgment';
    diagnostics?: CandidateJudgeDiagnostics;
  },
): Promise<JudgedCandidate[]> {
  const judgeContext = { voiceProfile, analysis, learnings, memory };
  if (diagnostics) {
    diagnostics.task = task;
    diagnostics.requested = candidates.length;
    diagnostics.mode = mode;
    diagnostics.requireModel = requireModel;
  }
  if (candidates.length === 0) {
    if (diagnostics) diagnostics.exitReason = 'no_candidates';
    return [];
  }
  if (mode === 'heuristic' || !hasTextGenerationProvider()) {
    if (requireModel) {
      if (diagnostics) diagnostics.exitReason = 'required_model_unavailable';
      return [];
    }
    const heuristic = candidates.map((candidate) => heuristicJudge(candidate, judgeContext));
    if (diagnostics) {
      diagnostics.parsed = heuristic.length;
      diagnostics.exitReason = 'heuristic';
    }
    return heuristic;
  }

  const prompt = candidates.map((candidate, idx) =>
    `[${idx}] format=${candidate.format} topic=${candidate.targetTopic}${candidate.sourceBrief ? ` source=${candidate.sourceBrief.slice(0, 280)}` : ''}\n${formatCandidateContentForJudgePrompt(candidate.content)}`
  ).join('\n\n');

  try {
    const manualAnchorBank = [
      ...(learnings?.operatorVoiceReference?.pinnedExamples || []),
      ...(learnings?.operatorVoiceReference?.startupRegisterExamples || []),
      ...(learnings?.operatorVoiceReference?.bestPerformers || []),
    ]
      .filter((entry, index, items) => (
        entry.content?.trim()
        && items.findIndex((item) => item.content === entry.content) === index
      ))
      .slice(0, 8)
      .map((entry, index) => `[NATIVE ${index + 1}] ${entry.content.slice(0, 260)}`)
      .join('\n');
    const geoffreyBrief = isGeoffreyVoiceProfile(voiceProfile)
      ? `\n${buildGeoffreyNativeWritingBrief()}
- Score native voice harshly: a draft must feel like Geoffrey thinking from technical constraints, not a generic account wearing frontier-tech nouns.
- Compare each candidate against the native anchor bank as a distribution of modes, not as prose to copy. A candidate may match one legitimate mode without averaging every anchor into one voice.
- If it is polished, balanced, and plausibly generated, cap overall at 0.45 even when the topic is relevant.
- Set nativeVoice below 0.55 whenever Geoffrey would be unlikely to post the wording himself.
- Set casualStartupFit below 0.50 when the draft reads like an analyst note instead of a casual, high-context startup take.
- Set stiffnessRisk at or above 0.50 for formal exposition, mechanism inventories, polished rhetorical questions, or an analyst setup followed by a cute metaphor.
- Set cringeRisk at or above 0.50 for consultant cadence, topic-swapped advice, synthetic status posturing, or technical nouns pasted onto a generic thesis.
- Set nativeVoice below 0.45 and cringeRisk at or above 0.55 for an unsituated technical mini-lecture, a mirrored "can do X and still Y / extremely A and extremely B" contrast, or a manufactured closer such as "X meets Y. Y wins," "congrats on X; Y still has standards," or "show me X, then we can argue." Correct mechanisms do not rescue generated prose.

NATIVE ANCHOR BANK:
${manualAnchorBank || '[no manual anchors available; be conservative]'}`
      : '';
    const response = await generateText({
      task,
      tier: 'fast',
      maxTokens: getBulkJudgeMaxTokens(candidates.length),
      system: `You are a brutally honest tweet quality judge for one X account.
Score each candidate from 0 to 1 on:
- overall
- voiceFit
- clarity
- novelty
- audienceFit
- policySafety
Also return:
- thesis: a short 4-10 word idea summary
- notes: one short sentence on the main improvement opportunity
- nativeVoice: likelihood from 0 to 1 that this person would plausibly post the exact wording
- casualStartupFit: likelihood from 0 to 1 that the diction is casual, high-context, and immediately relevant to companies, products, markets, capital, talent, or startup timing
- stiffnessRisk: likelihood from 0 to 1 that the draft sounds like an analyst memo, industry explainer, mechanism inventory, or polished research summary
- cringeRisk: likelihood from 0 to 1 that the draft feels generated, socially unearned, or interchangeable
- technicalCredibility: mechanism/constraint/specificity quality from 0 to 1
- manualAnchorReskinRisk: likelihood from 0 to 1 that the draft copies a manual anchor's premise, joke, list concept, opening move, social setup, or sentence skeleton while swapping in new nouns

Ground rules:
- Voice: ${voiceProfile.tone}
- Core topics: ${voiceProfile.topics.join(', ')}
- Anti-goals: ${voiceProfile.antiGoals.join('; ') || 'none'}
- Account fingerprint: ${analysis.contentFingerprint}
- Top formats: ${analysis.engagementPatterns.topFormats.join(', ') || 'unknown'}
- Top topics: ${analysis.engagementPatterns.topTopics.join(', ') || 'unknown'}
- Public taste feedback: if a commenter could say this sounds like AI slop, generated, consultant-polished, or ChatGPT-ish, score voiceFit/novelty/overall harshly.
- For @geoffwoo / frontier-tech taste, "concrete" must be elevated and technical. Slack channels, support tickets, dashboards, calendar invites, generic workflows, handoffs, renamed owners, and support queues are weak SaaS-ops texture, not sufficient proof.
- Reward elite technical anchors: inference ASIC constraints, chip packaging/yield, memory bandwidth, power delivery, grid interconnects, reactor/fuel-cycle details, separation chemistry, metrology, tolerances, robotics failure modes, launch/radiation/thermal constraints, and industrial supply-chain qualification.
- Penalize obvious generated-post cadence: "not X, but Y", "the real edge/moat/question", "most people don't realize", abstract leverage/moat/feedback-loop language without a concrete observed example, and overly neat numbered scaffolds.
- Penalize clean abstraction stacks that sound like advice for any AI/startup account after swapping the nouns.
- Reject generic instructional voice: audience-label openings, "start with", "you should", technical checklists, textbook definitions, and tidy three-paragraph explainers. Correct nouns do not make a native post.
- Reject unsituated technical lectures, mirrored adjective/adverb contrasts, and manufactured mic-drop endings. Long mechanism inventories, "can do X and still Y / extremely A and extremely B," "X meets Y. Y wins," "congrats on X; Y still has standards," and "show me X, then we can argue" are generated social copy, not Geoffrey voice.
- For Geoffrey, technical credibility and casual startup relevance are separate. Reward one useful mechanism attached to a sharp company, product, market, capital, talent, cost, or timing judgment. Penalize technical detail that never becomes a startup take.
- Reject "forecasts love X; reality is less cooperative," "founders love speed until...," "finance guys love...," "the calendar has physics," and polished "how do you model X when Y?" constructions as stiff generated analyst voice.
- A draft can sound native and still be a bad copy. Set manualAnchorReskinRisk at or above 0.50 when it recreates a native anchor's premise or structure, even if no exact phrase overlaps.
- Reward drafts that feel lived-in: asymmetric phrasing, concrete failure modes, named materials/technologies, specific operator observations, or one surprising detail that would be hard for a generic AI account to invent.
- A draft is not allowed to invent lived experience. Block anonymous anecdotes, first-person access, quotes, measurements, and precise numbers that are absent from the candidate's source field or manual anchors.
${geoffreyBrief}
${learnings?.insights?.length ? `- Learned rules: ${learnings.insights.slice(0, 3).join(' | ')}` : ''}
${learnings?.operatorVoiceReference?.bestPerformers?.length ? `- Manual/operator anchors are high-signal for voice, sentiment, tone, and topics: ${learnings.operatorVoiceReference.bestPerformers.slice(0, 3).map((entry) => `"${entry.content.slice(0, 120)}"`).join(' | ')}` : ''}
${memory?.neverDoThisAgain?.length ? `- Avoid: ${memory.neverDoThisAgain.slice(0, 3).join(' | ')}` : ''}
${memory?.operatorHiddenPreferences?.length ? `- Operator preferences: ${memory.operatorHiddenPreferences.slice(0, 3).join(' | ')}` : ''}
${memory?.editTransformations?.length ? `- Operator edit transformations: ${memory.editTransformations.slice(0, 2).join(' | ')}` : ''}
${memory?.referenceBank?.length ? `- Reference bank: ${memory.referenceBank.slice(0, 3).join(' | ')}` : ''}
${memory?.conversationInsights?.length ? `- Conversation lessons: ${memory.conversationInsights.slice(0, 2).join(' | ')}` : ''}
${memory?.audienceSegmentLessons?.length ? `- Audience lessons: ${memory.audienceSegmentLessons.slice(0, 2).join(' | ')}` : ''}
${memory?.outcomeFatigueLessons?.length ? `- Outcome fatigue: ${memory.outcomeFatigueLessons.slice(0, 2).join(' | ')}` : ''}

Output one JSON object per line, no markdown.`,
      prompt: `Judge these candidates:\n\n${prompt}`,
    });

    const parsed = parseScoredLines(response.text, candidates, judgeContext, {
      provider: response.provider,
      model: response.model,
    }, requireModel, task);
    if (diagnostics) {
      diagnostics.provider = response.provider;
      diagnostics.model = response.model;
      diagnostics.stopReason = response.stopReason;
      diagnostics.responseLength = response.text.length;
      diagnostics.responsePreview = response.text.slice(0, 2_000);
      diagnostics.parsed = parsed.length;
      diagnostics.exitReason = parsed.length > 0 ? 'model_parsed' : 'model_unparsed';
    }
    return parsed;
  } catch (error) {
    if (diagnostics) {
      diagnostics.exitReason = 'model_error';
      diagnostics.error = error instanceof Error ? error.message : String(error);
    }
    if (requireModel) return [];
    const heuristic = candidates.map((candidate) => heuristicJudge(candidate, judgeContext));
    if (diagnostics) diagnostics.parsed = heuristic.length;
    return heuristic;
  }
}

function parseMutationLines(
  text: string,
  candidates: JudgedCandidate[],
  generation: { provider: 'openai' | 'anthropic'; model: string },
): RankableProtocolTweet[] {
  const mutations: RankableProtocolTweet[] = [];

  const records = extractModelJsonRecords(text);
  const orderedVariantsPerCandidate = candidates.length > 0 && records.length === candidates.length * 3
    ? 3
    : 1;
  for (const [recordIndex, parsed] of records.entries()) {
    try {
      const explicitIndex = parsed.idx ?? parsed.candidate ?? parsed.index;
      const idx = explicitIndex === undefined || explicitIndex === null
        ? Math.floor(recordIndex / orderedVariantsPerCandidate)
        : Number(explicitIndex);
      const base = candidates[idx];
      const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
      if (!base || !content) continue;
      mutations.push({
        ...base,
        content,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : base.rationale,
        generationProvider: generation.provider,
        generationModel: generation.model,
        mutationRound: (base.mutationRound ?? 0) + 1,
        coverageCluster: null,
        judgeScore: null,
        judgeBreakdown: null,
        judgeNotes: null,
        judgeProvider: base.judgeProvider ?? null,
        judgeModel: base.judgeModel ?? null,
        finalCriticProvider: null,
        finalCriticModel: null,
        finalCriticVerdict: null,
        finalCriticScores: null,
        finalCriticVersion: null,
        featureTags: null,
      });
    } catch {
      // Skip malformed lines.
    }
  }

  return mutations;
}

export async function mutateTopCandidates(
  candidates: JudgedCandidate[],
  {
    voiceProfile,
    memory,
    learnings,
  }: {
    voiceProfile: VoiceProfile;
    memory: PersonalizationMemory | null;
    learnings?: AgentLearnings | null;
  },
): Promise<RankableProtocolTweet[]> {
  const geoffreyStrict = isGeoffreyVoiceProfile(voiceProfile);
  const mutationTargets = selectMutationTargets(candidates, voiceProfile);
  const voiceRescuePass = geoffreyStrict
    && mutationTargets.some((candidate) => (candidate.mutationRound ?? 0) >= 1);

  if (mutationTargets.length === 0 || !hasTextGenerationProvider()) {
    return [];
  }

  const prompt = mutationTargets.map((candidate, idx) => formatMutationCandidateForPrompt(candidate, idx)).join('\n\n');

  try {
    const startupRegisterReferences = learnings?.operatorVoiceReference?.startupRegisterExamples || [];
    const nativeAnchorBank = geoffreyStrict
      ? [
          ...startupRegisterReferences,
          ...(learnings?.operatorVoiceReference?.pinnedExamples || []),
          ...(learnings?.operatorVoiceReference?.bestPerformers || []),
        ]
          .filter((entry, index, items) => (
            entry.content?.trim()
            && items.findIndex((item) => item.content === entry.content) === index
          ))
          .slice(0, 8)
          .map((entry, index) => `[NATIVE ${index + 1}] ${formatNativeAnchorForPrompt(entry.content)}`)
          .join('\n')
      : '';
    const operatorCorrections = [
      ...(memory?.neverDoThisAgain || []),
      ...(memory?.operatorHiddenPreferences || []),
      ...(memory?.editTransformations || []),
    ]
      .filter((item, index, items) => item?.trim() && items.indexOf(item) === index)
      .slice(0, 3)
      .map((item) => `- ${item.slice(0, 180)}`)
      .join('\n');
    const system = geoffreyStrict
      ? `You are writing final versions for @geoffwoo. The rejected draft is disposable scaffolding, not prose to polish.
${voiceRescuePass ? '\nThis idea already failed one voice pass. Keep only the sourced fact and write from a genuinely different human thought.' : ''}

${buildGeoffreyNativeGenerationBrief()}

For each input, return three independent posts:
1. one blunt market or company take under 180 characters
2. one first-person bet or direct question
3. one loose two-beat reaction with a simpler second beat

Change the judgment or social posture across versions. Do not preserve the input's opening, syntax, noun pile, or closer. At least one version must plainly name who wins, loses, pays, or becomes harder to fund.
Keep every supplied fact fixed. First-person opinion is allowed; first-person access or evidence is not.

NATIVE MANUAL POSTS (diction evidence only):
${nativeAnchorBank || '[no manual anchors available; be conservative]'}
${operatorCorrections ? `\nCURRENT OPERATOR CORRECTIONS:\n${operatorCorrections}` : ''}

Output exactly three JSON objects per input idx, one object per line, with:
- idx
- content
- rationale`
      : `You improve tweet drafts without changing the author's identity.
Rules:
- Keep the same core thesis.
- Increase clarity, specificity, or punch.
- Remove weak throat-clearing.
- Remove AI slop tells: generic advice voice, symmetrical abstraction stacks, "the real edge", "most people miss", "not X but Y", and tidy consultant cadence.
- For a frontier-tech thesis, use one elevated technical anchor if it sharpens the claim: mechanism, number, constraint, named technology, material/process detail, failure mode, or technical/industrial operating observation.
- Make the startup consequence immediate: company, product, market, capital, talent, cost, margin, adoption, or timing. Technical detail is backing, not the whole post.
- Do not use Slack, support tickets, dashboards, calendar invites, generic workflow handoffs, or "renamed owner" as the main proof. For frontier-tech drafts, replace that texture with compute, energy, materials, manufacturing, robotics, or space constraints.
- Never add a fake founder/customer conversation, first-person event, benchmark, quote, or number. Preserve only evidence supplied with the candidate; otherwise rewrite as analysis or an explicit hypothesis.
- Do not preserve technical detail merely because it is correct. If it does not sharpen the startup judgment, delete it.
- Do not turn every tweet into the same template.
- Do not turn a position into advice. Reject audience-label openings, "start with", "you should", technical noun checklists, textbook definitions, and tidy three-paragraph explainers.
- Do not turn technical accuracy into a mini-lecture. Without a real named context, compress to one or two beats and one disputed implication.
- Delete mirrored contrasts and manufactured closers rather than polishing them: "can do X and still Y / extremely A and extremely B," "X meets Y. Y wins," "congrats on X; Y still has standards," and "show me X, then we can argue."
- Delete stiff analyst setups rather than making them cuter: "forecasts love X; reality is less cooperative," "founders love speed until...," "finance guys love...," "the calendar has physics," and polished "how do you model X when Y?" questions.
- Preserve roughness already present in the draft, but do not add fake typos, slang, or lowercase as voice costume.
- Stay in voice: ${voiceProfile.tone}.
${memory?.operatorHiddenPreferences?.length ? `Operator preferences: ${memory.operatorHiddenPreferences.slice(0, 3).join(' | ')}` : ''}
${memory?.editTransformations?.length ? `Operator edit transformations: ${memory.editTransformations.slice(0, 3).join(' | ')}` : ''}
${memory?.conversationInsights?.length ? `Conversation lessons: ${memory.conversationInsights.slice(0, 2).join(' | ')}` : ''}
${memory?.promptStrategyLessons?.length ? `Prompt strategy lessons: ${memory.promptStrategyLessons.slice(0, 2).join(' | ')}` : ''}
${memory?.outcomeFatigueLessons?.length ? `Outcome fatigue: ${memory.outcomeFatigueLessons.slice(0, 2).join(' | ')}` : ''}

Output one JSON object per line with:
- idx
- content
- rationale`;
    const response = await generateText({
      task: 'creative_variant',
      tier: 'fast',
      maxTokens: geoffreyStrict
        ? getGeoffreyMutationMaxTokens(mutationTargets.length)
        : getMutationMaxTokens(mutationTargets.length),
      openAiReasoningEffort: geoffreyStrict ? 'medium' : undefined,
      system,
      prompt: geoffreyStrict
        ? `Write three fresh final versions for each candidate:\n\n${prompt}`
        : `Rewrite these candidates once:\n\n${prompt}`,
    });

    return parseMutationLines(response.text, mutationTargets, {
      provider: response.provider,
      model: response.model,
    });
  } catch {
    return [];
  }
}
