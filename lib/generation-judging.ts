import { generateText, hasTextGenerationProvider } from './ai';
import type { AccountAnalysis } from './types';
import type { VoiceProfile } from './soul-parser';
import type { AgentLearnings, CandidateFeatureTags, CandidateJudgeBreakdown, PersonalizationMemory } from './types';
import type { RankableProtocolTweet } from './candidate-ranking';
import { buildCoverageCluster, extractCandidateFeatureTags } from './tweet-features';
import { assessTechnicalElevation, scoreSlopRisk } from './virality-signals';

type JudgeContext = {
  voiceProfile?: VoiceProfile;
  analysis?: AccountAnalysis;
  learnings?: AgentLearnings | null;
  memory?: PersonalizationMemory | null;
};

export type CandidateJudgeMode = 'model' | 'heuristic';
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
  return `[${idx}] format=${candidate.format} topic=${candidate.targetTopic}\ncontent=${content}\ncritic=${notes}`;
}

export function getMutationMaxTokens(targetCount: number): number {
  if (targetCount <= 2) return 1024;
  if (targetCount === 3) return 1536;
  return 2048;
}

export function getBulkJudgeMaxTokens(candidateCount: number): number {
  if (candidateCount <= 4) return 768;
  if (candidateCount <= 8) return 1280;
  if (candidateCount <= 12) return 1536;
  return 2048;
}

export interface JudgedCandidate extends RankableProtocolTweet {
  featureTags: CandidateFeatureTags;
  coverageCluster: string;
  judgeScore: number;
  judgeBreakdown: CandidateJudgeBreakdown;
  judgeNotes: string;
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
  const clarity = clamp(candidate.content.length >= 60 && candidate.content.length <= 900 ? 0.72 : 0.55);
  const technicalBoost = technicalElevation.technicalScore * 0.5;
  const banalPenalty = technicalElevation.banalOpsScore * 0.65;
  const novelty = clamp((featureTags.riskFlags.includes('thin') ? 0.48 : 0.68) - (slopRisk >= 0.45 ? 0.14 : 0) + technicalBoost - banalPenalty);
  const audienceFit = clamp(
    (/\b(founder|operator|builder|market|product|ai|startup)\b/i.test(candidate.content) ? 0.72 : 0.58)
    + (memoryFit.notes.includes('memory-aligned conversation value') ? 0.04 : 0)
    + technicalElevation.technicalScore * 0.35
    - technicalElevation.banalOpsScore * 0.45
  );
  const policySafety = clamp(
    1 - (featureTags.riskFlags.length * 0.12) - (memoryFit.penalty * 0.5) - (slopRisk * 0.18) + (memoryFit.boost * 0.25),
    0.32,
    0.9,
  );
  const voiceFit = clamp(
    scoreContextualVoiceFit(candidate, featureTags, context)
    - (slopRisk >= 0.5 ? 0.12 : slopRisk * 0.08)
    + technicalElevation.technicalScore * 0.25
    - technicalElevation.banalOpsScore * 0.55,
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
  const elevationNote = technicalElevation.hasBanalOpsTexture && !technicalElevation.hasHardTechAnchor
    ? ' Low-status ops texture: needs a harder technical/industrial anchor.'
    : technicalElevation.hasHardTechAnchor
      ? ' Technical anchor present.'
      : '';

  return {
    ...candidate,
    featureTags,
    coverageCluster: candidate.coverageCluster || buildCoverageCluster(candidate.content, candidate.targetTopic, featureTags.thesis),
    judgeScore: Number(overall.toFixed(3)),
    judgeBreakdown: {
      overall: Number(overall.toFixed(3)),
      voiceFit: Number(voiceFit.toFixed(3)),
      clarity: Number(clarity.toFixed(3)),
      novelty: Number(novelty.toFixed(3)),
      audienceFit: Number(audienceFit.toFixed(3)),
      policySafety: Number(policySafety.toFixed(3)),
    },
    judgeNotes: `Heuristic critic: ${featureTags.hook.replace(/_/g, ' ')} hook, ${featureTags.structure.replace(/_/g, ' ')} structure, ${featureTags.specificity.replace(/_/g, ' ')} specificity.${memoryNote}${slopNote}${elevationNote}`,
  };
}

function parseScoredLines(
  text: string,
  candidates: RankableProtocolTweet[],
  context: JudgeContext,
): JudgedCandidate[] {
  const judged = new Map<number, JudgedCandidate>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const idx = Number(parsed.idx);
      const candidate = candidates[idx];
      if (!candidate) continue;
      const featureTags = extractCandidateFeatureTags(candidate.content, {
        topic: candidate.targetTopic,
        thesisHint: typeof parsed.thesis === 'string' ? parsed.thesis : null,
      });
      const judgeBreakdown: CandidateJudgeBreakdown = {
        overall: clamp(Number(parsed.overall) || 0.5),
        voiceFit: clamp(Number(parsed.voiceFit) || 0.5),
        clarity: clamp(Number(parsed.clarity) || 0.5),
        novelty: clamp(Number(parsed.novelty) || 0.5),
        audienceFit: clamp(Number(parsed.audienceFit) || 0.5),
        policySafety: clamp(Number(parsed.policySafety) || 0.5),
      };
      judged.set(idx, {
        ...candidate,
        featureTags,
        coverageCluster: buildCoverageCluster(candidate.content, candidate.targetTopic, parsed.thesis || featureTags.thesis),
        judgeScore: Number(judgeBreakdown.overall.toFixed(3)),
        judgeBreakdown,
        judgeNotes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
      });
    } catch {
      // Skip malformed lines.
    }
  }

  return candidates.map((candidate, idx) => judged.get(idx) || heuristicJudge(candidate, context));
}

export async function judgeCandidates(
  candidates: RankableProtocolTweet[],
  {
    voiceProfile,
    analysis,
    learnings,
    memory,
    mode = 'model',
  }: {
    voiceProfile: VoiceProfile;
    analysis: AccountAnalysis;
    learnings: AgentLearnings | null;
    memory: PersonalizationMemory | null;
    mode?: CandidateJudgeMode;
  },
): Promise<JudgedCandidate[]> {
  const judgeContext = { voiceProfile, analysis, learnings, memory };
  if (candidates.length === 0 || mode === 'heuristic' || !hasTextGenerationProvider()) {
    return candidates.map((candidate) => heuristicJudge(candidate, judgeContext));
  }

  const prompt = candidates.map((candidate, idx) =>
    `[${idx}] format=${candidate.format} topic=${candidate.targetTopic}\n${formatCandidateContentForJudgePrompt(candidate.content)}`
  ).join('\n\n');

  try {
    const response = await generateText({
      task: 'bulk_judgment',
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

Ground rules:
- Voice: ${voiceProfile.tone}
- Core topics: ${voiceProfile.topics.join(', ')}
- Anti-goals: ${voiceProfile.antiGoals.join('; ') || 'none'}
- Account fingerprint: ${analysis.contentFingerprint}
- Top formats: ${analysis.engagementPatterns.topFormats.join(', ') || 'unknown'}
- Top topics: ${analysis.engagementPatterns.topTopics.join(', ') || 'unknown'}
- Public taste feedback: if a commenter could say this sounds like AI slop, generated, consultant-polished, or ChatGPT-ish, score voiceFit/novelty/overall harshly.
- For @geoffreywoo / frontier-tech taste, "concrete" must be elevated and technical. Slack channels, support tickets, dashboards, calendar invites, generic workflows, handoffs, renamed owners, and support queues are weak SaaS-ops texture, not sufficient proof.
- Reward elite technical anchors: inference ASIC constraints, chip packaging/yield, memory bandwidth, power delivery, grid interconnects, reactor/fuel-cycle details, separation chemistry, metrology, tolerances, robotics failure modes, launch/radiation/thermal constraints, and industrial supply-chain qualification.
- Penalize obvious generated-post cadence: "not X, but Y", "the real edge/moat/question", "most people don't realize", abstract leverage/moat/feedback-loop language without a concrete observed example, and overly neat numbered scaffolds.
- Penalize clean abstraction stacks that sound like advice for any AI/startup account after swapping the nouns.
- Reward drafts that feel lived-in: asymmetric phrasing, concrete failure modes, named materials/technologies, specific operator observations, or one surprising detail that would be hard for a generic AI account to invent.
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

    return parseScoredLines(response.text, candidates, judgeContext);
  } catch {
    return candidates.map((candidate) => heuristicJudge(candidate, judgeContext));
  }
}

function parseMutationLines(
  text: string,
  candidates: JudgedCandidate[],
): RankableProtocolTweet[] {
  const mutations: RankableProtocolTweet[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const idx = Number(parsed.idx);
      const base = candidates[idx];
      const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
      if (!base || !content) continue;
      mutations.push({
        ...base,
        content,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : base.rationale,
        mutationRound: (base.mutationRound ?? 0) + 1,
        coverageCluster: null,
        judgeScore: null,
        judgeBreakdown: null,
        judgeNotes: null,
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
  }: {
    voiceProfile: VoiceProfile;
    memory: PersonalizationMemory | null;
  },
): Promise<RankableProtocolTweet[]> {
  const mutationTargets = [...candidates]
    .sort((a, b) => (b.judgeScore || 0) - (a.judgeScore || 0))
    .slice(0, Math.min(4, candidates.length))
    .filter((candidate) => (candidate.judgeScore || 0) >= 0.48);

  if (mutationTargets.length === 0 || !hasTextGenerationProvider()) {
    return [];
  }

  const prompt = mutationTargets.map((candidate, idx) => formatMutationCandidateForPrompt(candidate, idx)).join('\n\n');

  try {
    const response = await generateText({
      task: 'creative_variant',
      tier: 'fast',
      maxTokens: getMutationMaxTokens(mutationTargets.length),
      system: `You improve tweet drafts without changing the author's identity.
Rules:
- Keep the same core thesis.
- Increase clarity, specificity, or punch.
- Remove weak throat-clearing.
- Remove AI slop tells: generic advice voice, symmetrical abstraction stacks, "the real edge", "most people miss", "not X but Y", and tidy consultant cadence.
- Add one elevated technical anchor if missing: mechanism, number, constraint, named technology, material/process detail, failure mode, or technical/industrial operating observation.
- Do not use Slack, support tickets, dashboards, calendar invites, generic workflow handoffs, or "renamed owner" as the main proof. For frontier-tech drafts, replace that texture with compute, energy, materials, manufacturing, robotics, or space constraints.
- Do not turn every tweet into the same template.
- Stay in voice: ${voiceProfile.tone}.
${memory?.operatorHiddenPreferences?.length ? `Operator preferences: ${memory.operatorHiddenPreferences.slice(0, 3).join(' | ')}` : ''}
${memory?.editTransformations?.length ? `Operator edit transformations: ${memory.editTransformations.slice(0, 3).join(' | ')}` : ''}
${memory?.conversationInsights?.length ? `Conversation lessons: ${memory.conversationInsights.slice(0, 2).join(' | ')}` : ''}
${memory?.promptStrategyLessons?.length ? `Prompt strategy lessons: ${memory.promptStrategyLessons.slice(0, 2).join(' | ')}` : ''}
${memory?.outcomeFatigueLessons?.length ? `Outcome fatigue: ${memory.outcomeFatigueLessons.slice(0, 2).join(' | ')}` : ''}

Output one JSON object per line with:
- idx
- content
- rationale`,
      prompt: `Rewrite these candidates once:\n\n${prompt}`,
    });

    return parseMutationLines(response.text, mutationTargets);
  } catch {
    return [];
  }
}
