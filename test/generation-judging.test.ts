import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCandidateContentForJudgePrompt, formatMutationCandidateForPrompt, getBulkJudgeMaxTokens, getMutationMaxTokens, judgeCandidates, mutateTopCandidates } from '@/lib/generation-judging';
import type { AccountAnalysis, PersonalizationMemory } from '@/lib/types';
import type { JudgedCandidate } from '@/lib/generation-judging';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  hasProvider: vi.fn(() => false),
}));

vi.mock('@/lib/ai', () => ({
  generateText: mocks.generateText,
  hasTextGenerationProvider: () => mocks.hasProvider(),
}));

function analysis(): AccountAnalysis {
  return {
    agentId: 'agent-1',
    analyzedAt: '2026-06-06T00:00:00.000Z',
    tweetCount: 20,
    viralTweets: [],
    engagementPatterns: {
      avgLikes: 12,
      avgRetweets: 2,
      avgReplies: 3,
      avgImpressions: 600,
      topHours: [15],
      topFormats: ['hot_take'],
      topTopics: ['AI agents'],
      viralThreshold: 50,
    },
    followingProfile: {
      totalFollowing: 0,
      topAccounts: [],
      categories: [],
    },
    contentFingerprint: 'Specific operator lessons about AI agents.',
  };
}

function memory(overrides: Partial<PersonalizationMemory> = {}): PersonalizationMemory {
  return {
    alwaysDoMoreOfThis: [],
    neverDoThisAgain: [],
    topicsWithMomentum: [],
    formatsUnderTested: [],
    operatorHiddenPreferences: [],
    editTransformations: [],
    identityConstraints: [],
    weeklyChanges: [],
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...overrides,
  };
}

function judgedCandidate(overrides: Partial<JudgedCandidate> = {}): JudgedCandidate {
  return {
    content: 'AI agent teams learn faster when every failed eval becomes a rollback rule.',
    format: 'hot_take',
    targetTopic: 'AI agents',
    rationale: 'Specific operator lesson.',
    sourceLane: null,
    styleMode: 'standard',
    creativeLane: 'operator_take',
    draftExperimentId: null,
    experimentBatchId: null,
    experimentHypothesis: null,
    experimentHoldout: false,
    promptVariant: null,
    targetAudienceSegment: 'ai_builders',
    segmentHypothesis: 'AI builders care about safer autonomy.',
    mediaExperimentType: 'text_only',
    mediaBrief: null,
    portfolioRole: 'proof',
    relationshipTargetHandle: null,
    trendFitScore: null,
    trendTopicId: null,
    trendHeadline: null,
    featureTags: {
      hook: 'bold_claim',
      tone: 'analytical',
      specificity: 'tactical',
      structure: 'single_punch',
      thesis: 'failed eval rollback rule',
      riskFlags: [],
    },
    coverageCluster: 'ai agents:failed eval rollback rule',
    judgeScore: 0.82,
    judgeBreakdown: {
      overall: 0.82,
      voiceFit: 0.84,
      clarity: 0.8,
      novelty: 0.78,
      audienceFit: 0.79,
      policySafety: 0.94,
    },
    judgeNotes: 'Strong core thesis; tighten the opening.',
    ...overrides,
  };
}

describe('judgeCandidates fallback critic', () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.hasProvider.mockReturnValue(false);
  });

  it('trims long candidate text only for the model critic prompt', () => {
    const longContent = `opening ${'long evidence '.repeat(140)}final tail`;
    const trimmed = formatCandidateContentForJudgePrompt(longContent);

    expect(trimmed.length).toBeLessThan(longContent.length);
    expect(trimmed).toContain('[trimmed for critic; full draft is used by ranking and output]');
    expect(trimmed).not.toContain('final tail');
  });

  it('budgets mutation output tokens by target count', () => {
    expect(getBulkJudgeMaxTokens(1)).toBe(768);
    expect(getBulkJudgeMaxTokens(4)).toBe(768);
    expect(getBulkJudgeMaxTokens(8)).toBe(1280);
    expect(getBulkJudgeMaxTokens(12)).toBe(1536);
    expect(getBulkJudgeMaxTokens(16)).toBe(2048);
    expect(getMutationMaxTokens(1)).toBe(1024);
    expect(getMutationMaxTokens(2)).toBe(1024);
    expect(getMutationMaxTokens(3)).toBe(1536);
    expect(getMutationMaxTokens(4)).toBe(2048);
  });

  it('trims long mutation prompt content and critic notes', () => {
    const candidate = judgedCandidate({
      content: `opening ${'mutation evidence '.repeat(100)}FINAL_MUTATION_SENTINEL`,
      judgeNotes: `tighten ${'critic note '.repeat(50)}FINAL_NOTE_SENTINEL`,
    });

    const prompt = formatMutationCandidateForPrompt(candidate, 0);

    expect(prompt).toContain('[trimmed for mutation; preserve the core thesis]');
    expect(prompt).not.toContain('FINAL_MUTATION_SENTINEL');
    expect(prompt).not.toContain('FINAL_NOTE_SENTINEL');
  });

  it('uses account memory when no text generation provider is configured', async () => {
    const judged = await judgeCandidates([
      {
        content: 'AI agents will unlock viral growth. DM me to subscribe.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Generic promotional promise.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents viral growth',
          riskFlags: ['salesy'],
        },
      },
      {
        content: [
          'AI agent teams learn faster when every failed eval becomes a rollback rule.',
          'The weekly review should name the broken assumption, the guardrail, and the owner.',
        ].join('\n'),
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Specific operator lesson.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'manifesto',
          thesis: 'failed eval rollback rule',
          riskFlags: [],
        },
      },
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: ['generic hype'],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI operator voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory({
        neverDoThisAgain: ['Avoid generic promotional CTA language and vague hype.'],
        operatorHiddenPreferences: [
          'Operators add sharper specifics, evidence, or examples before approving.',
          'Line-break structure improves readability and approval odds.',
        ],
        conversationInsights: ['Substantive replies come from concrete mechanisms, not engagement bait.'],
      }),
    });

    const promotional = judged.find((candidate) => candidate.content.includes('unlock viral growth'));
    const specific = judged.find((candidate) => candidate.content.includes('failed eval'));

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(promotional).toBeDefined();
    expect(specific).toBeDefined();
    expect(specific!.judgeScore).toBeGreaterThan(promotional!.judgeScore);
    expect(specific!.judgeBreakdown.voiceFit).toBeGreaterThan(promotional!.judgeBreakdown.voiceFit);
    expect(specific!.judgeBreakdown.policySafety).toBeGreaterThan(promotional!.judgeBreakdown.policySafety);
    expect(specific!.judgeNotes).toContain('memory-aligned specificity');
    expect(specific!.judgeNotes).toContain('memory-aligned structure');
    expect(promotional!.judgeNotes).toContain('memory conflict: promotional');
  });

  it('can use the learned heuristic critic even when a provider is configured', async () => {
    mocks.hasProvider.mockReturnValue(true);

    const judged = await judgeCandidates([
      {
        content: 'AI agent teams learn faster when every failed eval becomes a rollback rule.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Specific operator lesson.',
      },
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI operator voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory(),
      mode: 'heuristic',
    });

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(judged[0].judgeNotes).toContain('Heuristic critic');
    expect(judged[0].judgeBreakdown).toEqual(expect.objectContaining({
      overall: expect.any(Number),
      voiceFit: expect.any(Number),
    }));
  });

  it('penalizes AI-slop cadence in the heuristic critic', async () => {
    const judged = await judgeCandidates([
      {
        content: 'The real edge in AI is not better tools, but tighter feedback loops. Most people miss that leverage compounds when systems learn faster.',
        format: 'hot_take',
        targetTopic: 'AI infrastructure',
        rationale: 'Formulaic abstraction stack.',
        featureTags: {
          hook: 'contrarian',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'argument',
          thesis: 'ai feedback loops compound',
          riskFlags: [],
        },
      },
      {
        content: 'Inference chips are turning into a power routing problem.\n\nThe weird bottleneck is not the model. It is how many amps you can move across one rack before the board turns into a space heater.',
        format: 'observation',
        targetTopic: 'inference asics',
        rationale: 'Concrete technical constraint.',
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'concrete',
          structure: 'stacked_lines',
          thesis: 'inference chips power routing bottleneck',
          riskFlags: [],
        },
      },
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['ai', 'inference asics'],
        antiGoals: ['AI slop and generic abstraction stacks'],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI infrastructure voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory({
        neverDoThisAgain: ['Avoid AI slop, generic advice, and generated-sounding template cadence.'],
        operatorHiddenPreferences: ['Use concrete mechanisms, constraints, numbers, materials, or failure modes.'],
      }),
    });

    const slop = judged[0];
    const concrete = judged[1];

    expect(concrete.judgeScore).toBeGreaterThan(slop.judgeScore);
    expect(concrete.judgeBreakdown.voiceFit).toBeGreaterThan(slop.judgeBreakdown.voiceFit);
    expect(concrete.judgeBreakdown.novelty).toBeGreaterThan(slop.judgeBreakdown.novelty);
    expect(slop.judgeNotes).toContain('Slop risk');
  });

  it('uses a model critic when requested and a provider is available', async () => {
    mocks.hasProvider.mockReturnValue(true);
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        idx: 0,
        overall: 0.91,
        voiceFit: 0.92,
        clarity: 0.9,
        novelty: 0.88,
        audienceFit: 0.86,
        policySafety: 0.94,
        thesis: 'failed eval rollback rule',
        notes: 'Strong operator-specific mechanism.',
      }),
    });

    const judged = await judgeCandidates([
      {
        content: 'AI agent teams learn faster when every failed eval becomes a rollback rule.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Specific operator lesson.',
      },
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI operator voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory(),
      mode: 'model',
    });

    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      task: 'bulk_judgment',
      tier: 'fast',
      maxTokens: 768,
    }));
    expect(judged[0].judgeScore).toBe(0.91);
    expect(judged[0].judgeNotes).toBe('Strong operator-specific mechanism.');
  });

  it('sends trimmed long drafts to the model critic without truncating returned candidates', async () => {
    mocks.hasProvider.mockReturnValue(true);
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        idx: 0,
        overall: 0.82,
        voiceFit: 0.86,
        clarity: 0.8,
        novelty: 0.78,
        audienceFit: 0.79,
        policySafety: 0.93,
        thesis: 'long draft operator lesson',
        notes: 'Promising but should tighten.',
      }),
    });
    const longContent = `AI agent launches fail when eval notes do not become rollback rules.\n\n${'The team needs visible proof before expanding autonomy. '.repeat(80)}FINAL_SENTINEL`;

    const judged = await judgeCandidates([
      {
        content: longContent,
        format: 'long_form',
        targetTopic: 'AI agents',
        rationale: 'Long-form operator lesson.',
      },
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI operator voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory(),
      mode: 'model',
    });

    const prompt = String(mocks.generateText.mock.calls[0]?.[0]?.prompt || '');
    expect(prompt).toContain('[trimmed for critic; full draft is used by ranking and output]');
    expect(prompt).not.toContain('FINAL_SENTINEL');
    expect(judged[0].content).toBe(longContent);
  });

  it('sends compact mutation prompts while preserving generated rewrites', async () => {
    mocks.hasProvider.mockReturnValue(true);
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        idx: 0,
        content: 'AI agent teams earn trust when every failed eval creates a visible rollback rule.',
        rationale: 'Sharper and more concrete.',
      }),
    });
    const sourceContent = `AI agent launches fail when eval notes do not become rollback rules.\n\n${'The team needs visible proof before expanding autonomy. '.repeat(80)}FINAL_MUTATION_SENTINEL`;

    const mutations = await mutateTopCandidates([
      judgedCandidate({
        content: sourceContent,
        judgeNotes: `Keep the thesis, but tighten ${'the critic context '.repeat(40)}FINAL_NOTE_SENTINEL`,
      }),
      judgedCandidate({
        content: 'Short second candidate with enough score.',
        judgeScore: 0.7,
      }),
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI operator voice.',
      },
      memory: memory(),
    });

    const call = mocks.generateText.mock.calls[0]?.[0];
    const prompt = String(call?.prompt || '');
    expect(call).toEqual(expect.objectContaining({
      task: 'creative_variant',
      tier: 'fast',
      maxTokens: 1024,
    }));
    expect(prompt).toContain('[trimmed for mutation; preserve the core thesis]');
    expect(prompt).not.toContain('FINAL_MUTATION_SENTINEL');
    expect(prompt).not.toContain('FINAL_NOTE_SENTINEL');
    expect(mutations[0].content).toBe('AI agent teams earn trust when every failed eval creates a visible rollback rule.');
  });
});
