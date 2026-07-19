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

  it('prefers elevated technical anchors over Slack-channel ops texture', async () => {
    const judged = await judgeCandidates([
      {
        content: 'AI adoption is obvious when the Slack channel gets quieter and the support queue stops lighting up after the workflow handoff changes.',
        format: 'observation',
        targetTopic: 'AI',
        rationale: 'Low-status SaaS ops texture.',
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'concrete',
          structure: 'single_punch',
          thesis: 'slack support queue adoption proof',
          riskFlags: [],
        },
      },
      {
        content: 'Inference ASIC adoption is obvious when HBM bandwidth, packaging yield, and rack power density survive the next model shape change.',
        format: 'observation',
        targetTopic: 'inference asics',
        rationale: 'Elevated technical constraint.',
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'inference asic deployment constraints',
          riskFlags: [],
        },
      },
    ], {
      voiceProfile: {
        tone: 'technical analyst',
        topics: ['ai', 'inference asics', 'frontier tech'],
        antiGoals: ['Slack channels, support queues, and generic workflow handoffs as proof of depth'],
        communicationStyle: 'elevated technical frontier-tech voice',
        summary: 'Elite frontier tech voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory({
        neverDoThisAgain: ['Avoid Slack-channel and support-ticket texture.'],
        operatorHiddenPreferences: ['Prefer chip, power, materials, manufacturing, and hard-technology constraints.'],
      }),
    });

    const ops = judged[0];
    const technical = judged[1];

    expect(technical.judgeScore).toBeGreaterThan(ops.judgeScore);
    expect(technical.judgeBreakdown.voiceFit).toBeGreaterThan(ops.judgeBreakdown.voiceFit);
    expect(technical.judgeNotes).toContain('Technical anchor present');
    expect(ops.judgeNotes).toContain('Low-status ops texture');
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

  it('blocks a high-scoring Geoffrey draft that reskins a manual anchor premise', async () => {
    mocks.hasProvider.mockReturnValue(true);
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        idx: 0,
        overall: 0.92,
        voiceFit: 0.9,
        clarity: 0.88,
        novelty: 0.84,
        audienceFit: 0.9,
        policySafety: 0.94,
        nativeVoice: 0.86,
        cringeRisk: 0.12,
        technicalCredibility: 0.7,
        manualAnchorReskinRisk: 0.88,
        thesis: 'transformer access as status',
        notes: 'Native cadence, but it copies the status-list premise.',
      }),
    });

    const judged = await judgeCandidates([
      {
        content: '2026 status is knowing which dinner guests can get a transformer delivered before your data center interconnect expires.',
        format: 'short_punch',
        targetTopic: 'culture',
        rationale: 'A technical status joke.',
      },
    ], {
      voiceProfile: {
        tone: 'provocative',
        topics: ['ai', 'hardware'],
        antiGoals: ['generic hype'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: native operator voice.',
        summary: 'Geoffrey writes compressed technical and social observations.',
      },
      analysis: analysis(),
      learnings: {
        operatorVoiceReference: {
          sampleCount: 1,
          bestPerformers: [
            {
              tweetId: '',
              xTweetId: 'native-status-anchor',
              content: 'SF rich:\n- estate in woodside\n- host dinner parties with ai founders\n- play padel on your home court',
              format: 'short_punch',
              topic: 'culture',
              postedAt: '2026-06-01T00:00:00.000Z',
              checkedAt: '2026-06-02T00:00:00.000Z',
              likes: 410,
              retweets: 7,
              replies: 13,
              impressions: 20_000,
              engagementRate: 2.15,
              wasViral: true,
              source: 'timeline',
              styleMode: 'standard',
              hook: 'observation',
              tone: 'sarcastic',
              specificity: 'concrete',
            } as any,
          ],
          styleFingerprint: {
            avgLength: 180,
            shortPct: 0,
            mediumPct: 100,
            longPct: 0,
            questionRatio: 0,
            usesLineBreaks: true,
            usesEmojis: false,
            usesNumbers: false,
            topHooks: ['observation'],
            topTones: ['sarcastic'],
            antiPatterns: [],
            updatedAt: '2026-06-06T00:00:00.000Z',
          },
          pinnedExamples: [],
          blockedXTweetIds: [],
        },
      } as any,
      memory: memory(),
      mode: 'model',
    });

    expect(judged[0].judgeBreakdown.manualAnchorReskinRisk).toBe(0.88);
    expect(judged[0].judgeScore).toBeLessThanOrEqual(0.45);
    expect(judged[0].judgeNotes).toContain('anchorReskin=0.88');
    expect(String(mocks.generateText.mock.calls[0]?.[0]?.system || '')).toContain('manualAnchorReskinRisk');
    expect(String(mocks.generateText.mock.calls[0]?.[0]?.system || '')).toContain('unsituated technical mini-lecture');
    expect(String(mocks.generateText.mock.calls[0]?.[0]?.system || '')).toContain('X meets Y. Y wins');
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
