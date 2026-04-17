import { generateText, hasTextGenerationProvider } from './ai';
import type { AccountAnalysis } from './types';
import type { VoiceProfile } from './soul-parser';
import type { AgentLearnings, CandidateFeatureTags, CandidateJudgeBreakdown, PersonalizationMemory } from './types';
import type { RankableProtocolTweet } from './candidate-ranking';
import { buildCoverageCluster, extractCandidateFeatureTags } from './tweet-features';

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

function heuristicJudge(candidate: RankableProtocolTweet): JudgedCandidate {
  const featureTags = candidate.featureTags || extractCandidateFeatureTags(candidate.content, {
    topic: candidate.targetTopic,
  });
  const clarity = clamp(candidate.content.length >= 60 && candidate.content.length <= 900 ? 0.72 : 0.55);
  const novelty = clamp(featureTags.riskFlags.includes('thin') ? 0.48 : 0.68);
  const audienceFit = clamp(/\b(founder|operator|builder|market|product|ai|startup)\b/i.test(candidate.content) ? 0.72 : 0.58);
  const policySafety = clamp(1 - (featureTags.riskFlags.length * 0.12), 0.32, 0.88);
  const voiceFit = clamp(
    candidate.targetTopic ? 0.72 : 0.58,
    0.52,
    0.82,
  );
  const overall = clamp(
    voiceFit * 0.28 +
    clarity * 0.18 +
    novelty * 0.18 +
    audienceFit * 0.2 +
    policySafety * 0.16
  );

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
    judgeNotes: `Heuristic critic: ${featureTags.hook.replace(/_/g, ' ')} hook, ${featureTags.structure.replace(/_/g, ' ')} structure, ${featureTags.specificity.replace(/_/g, ' ')} specificity.`,
  };
}

function parseScoredLines(
  text: string,
  candidates: RankableProtocolTweet[],
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

  return candidates.map((candidate, idx) => judged.get(idx) || heuristicJudge(candidate));
}

export async function judgeCandidates(
  candidates: RankableProtocolTweet[],
  {
    voiceProfile,
    analysis,
    learnings,
    memory,
  }: {
    voiceProfile: VoiceProfile;
    analysis: AccountAnalysis;
    learnings: AgentLearnings | null;
    memory: PersonalizationMemory | null;
  },
): Promise<JudgedCandidate[]> {
  if (candidates.length === 0 || !hasTextGenerationProvider()) {
    return candidates.map(heuristicJudge);
  }

  const prompt = candidates.map((candidate, idx) =>
    `[${idx}] format=${candidate.format} topic=${candidate.targetTopic}\n${candidate.content}`
  ).join('\n\n');

  try {
    const response = await generateText({
      tier: 'fast',
      maxTokens: 2048,
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
${learnings?.insights?.length ? `- Learned rules: ${learnings.insights.slice(0, 3).join(' | ')}` : ''}
${memory?.neverDoThisAgain?.length ? `- Avoid: ${memory.neverDoThisAgain.slice(0, 3).join(' | ')}` : ''}

Output one JSON object per line, no markdown.`,
      prompt: `Judge these candidates:\n\n${prompt}`,
    });

    return parseScoredLines(response.text, candidates);
  } catch {
    return candidates.map(heuristicJudge);
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

  const prompt = mutationTargets.map((candidate, idx) =>
    `[${idx}] format=${candidate.format} topic=${candidate.targetTopic}\ncontent=${candidate.content}\ncritic=${candidate.judgeNotes}`
  ).join('\n\n');

  try {
    const response = await generateText({
      tier: 'fast',
      maxTokens: 2048,
      system: `You improve tweet drafts without changing the author's identity.
Rules:
- Keep the same core thesis.
- Increase clarity, specificity, or punch.
- Remove weak throat-clearing.
- Do not turn every tweet into the same template.
- Stay in voice: ${voiceProfile.tone}.
${memory?.operatorHiddenPreferences?.length ? `Operator preferences: ${memory.operatorHiddenPreferences.slice(0, 3).join(' | ')}` : ''}

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
