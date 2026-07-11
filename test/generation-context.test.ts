import { describe, expect, it, vi } from 'vitest';
import {
  addRemixEntry,
  addPerformanceEntry,
  addVoiceDirective,
  getVoiceDirectiveRules,
  createAgent,
  createTweet,
  saveFeedback,
  saveLearnings,
  saveStyleSignals,
  saveAnalysis,
  markIdeaAtomRejectedForTweet,
} from '@/lib/kv-storage';
import { buildGenerationContext, curateIdeaBankForGeneration } from '@/lib/generation-context';
import type { IdeaAtom } from '@/lib/types';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {},
}));

function ideaAtom(overrides: Partial<IdeaAtom> & { claim: string }): IdeaAtom {
  return {
    id: overrides.id || `atom-${overrides.claim.slice(0, 8)}`,
    agentId: overrides.agentId || 'agent-1',
    claim: overrides.claim,
    tension: overrides.tension ?? null,
    audience: overrides.audience ?? 'ai_builders',
    proof: overrides.proof ?? null,
    example: overrides.example ?? overrides.claim,
    riskNote: overrides.riskNote ?? null,
    topic: overrides.topic ?? 'AI agents',
    sourceTweetId: overrides.sourceTweetId ?? null,
    lastUsedAt: overrides.lastUsedAt ?? '2026-04-15T00:00:00.000Z',
    performance: overrides.performance || {
      generated: 1,
      queued: 0,
      posted: 0,
      rejected: 0,
      avgReward: 0,
    },
    createdAt: overrides.createdAt || '2026-04-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-15T00:00:00.000Z',
  };
}

describe('idea bank curation', () => {
  it('promotes proven thesis atoms while withholding rejected and saturated atoms from references', () => {
    const bank = curateIdeaBankForGeneration([
      ideaAtom({
        claim: 'agent memory eval loops compound faster than dashboards',
        performance: {
          generated: 6,
          queued: 5,
          posted: 4,
          rejected: 0,
          avgReward: 0.62,
        },
      }),
      ideaAtom({
        claim: 'ai agents replace every employee',
        riskNote: 'Rejected: Overclaimed and not tasteful',
        performance: {
          generated: 5,
          queued: 1,
          posted: 0,
          rejected: 4,
          avgReward: -0.56,
        },
      }),
      ideaAtom({
        claim: 'agent teams need eval loops before adding tools',
        lastUsedAt: '2026-04-17T00:00:00.000Z',
        performance: {
          generated: 12,
          queued: 8,
          posted: 7,
          rejected: 0,
          avgReward: 0.66,
        },
      }),
    ], {
      now: new Date('2026-04-18T00:00:00.000Z').getTime(),
    });

    expect(bank.reusable.map((entry) => entry.atom.claim)).toContain('agent memory eval loops compound faster than dashboards');
    expect(bank.referenceClaims).toContain('agent memory eval loops compound faster than dashboards');
    expect(bank.referenceClaims).not.toContain('ai agents replace every employee');
    expect(bank.caution.find((entry) => entry.atom.claim === 'ai agents replace every employee')?.label).toBe('rework_or_avoid');
    expect(bank.caution.find((entry) => entry.atom.claim === 'agent teams need eval loops before adding tools')?.label).toBe('cooldown');
  });
});

describe('generation context', () => {
  it('builds the live policy from unique posts and includes operator timeline evidence', async () => {
    const agent = await createAgent({
      handle: 'context-agent-performance-evidence',
      name: 'Context Agent Performance Evidence',
      soulMd: '# SOUL\n\nDirect.',
    } as any);
    const base = {
      tweetId: 'auto-1',
      xTweetId: 'x-auto-1',
      content: 'autopilot infrastructure observation',
      format: 'analysis',
      topic: 'AI infrastructure',
      postedAt: '2026-07-01T00:00:00.000Z',
      likes: 4,
      retweets: 0,
      replies: 1,
      impressions: 500,
      engagementRate: 1,
      wasViral: false,
      source: 'autopilot',
    } as const;
    await addPerformanceEntry(agent.id, { ...base, checkedAt: '2026-07-01T00:15:00.000Z' } as any);
    await addPerformanceEntry(agent.id, { ...base, likes: 8, checkedAt: '2026-07-01T02:00:00.000Z' } as any);
    await addPerformanceEntry(agent.id, {
      ...base,
      tweetId: '',
      xTweetId: 'x-manual-1',
      content: 'manual killer opener\n\nsharp second line',
      format: 'hot_take',
      topic: 'AI',
      likes: 90,
      retweets: 8,
      replies: 6,
      source: 'timeline',
      checkedAt: '2026-07-01T02:00:00.000Z',
    } as any);

    const context = await buildGenerationContext(agent);

    expect(context.style.banditPolicy?.trainingSource).toBe('mixed');
    expect(context.style.banditPolicy?.evidence).toMatchObject({
      performanceRows: 3,
      uniquePerformancePosts: 2,
      collapsedSnapshots: 1,
      operatorWrittenPosts: 1,
      systemWrittenPosts: 1,
    });
  });

  it('includes operator learning signals and orders directives oldest to newest', async () => {
    const agent = await createAgent({
      handle: 'context-agent-1',
      name: 'Context Agent 1',
      soulMd: '# SOUL\n\nSharp and specific.',
    } as any);

    await saveStyleSignals(agent.id, {
      sentenceLength: 'short',
      vocabulary: 'mixed',
      toneMarkers: ['sharp'],
      topicPreferences: ['AI'],
      rawExtraction: 'Wizard voice fingerprint',
    });

    await saveFeedback(agent.id, {
      tweetId: 'bad-1',
      tweetText: 'bad tweet',
      rating: 'down',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Too vague',
      source: 'queue_delete',
      userProvidedReason: true,
    });

    await addRemixEntry(agent.id, {
      direction: 'shorter',
      originalContent: 'original 1',
      remixedContent: 'remix 1',
      ts: new Date().toISOString(),
    });
    await addRemixEntry(agent.id, {
      direction: 'shorter',
      originalContent: 'original 2',
      remixedContent: 'remix 2',
      ts: new Date().toISOString(),
    });
    await addRemixEntry(agent.id, {
      direction: 'shorter',
      originalContent: 'original 3',
      remixedContent: 'remix 3',
      ts: new Date().toISOString(),
    });

    await addVoiceDirective(agent.id, 'Use calmer endings.');
    await addVoiceDirective(agent.id, 'Lead with specifics.');

    await createTweet({
      agentId: agent.id,
      content: 'already queued tweet',
      type: 'original',
      status: 'queued',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const context = await buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 });
    const directiveRules = await getVoiceDirectiveRules(agent.id);

    expect(context.voiceProfile.communicationStyle).toContain('Style analysis: Wizard voice fingerprint');
    expect(context.voiceProfile.communicationStyle).toContain('bad tweet (why it was rejected: Too vague)');
    expect(context.voiceProfile.communicationStyle).toContain('Keep tweets short and punchy');
    expect(context.voiceProfile.communicationStyle).toContain('1. Land tweets with calm, restrained endings.');
    expect(context.voiceProfile.communicationStyle).toContain('2. Open tweets with specific details before abstractions.');
    expect(context.voiceProfile.communicationStyle).toContain('Raw coaching: Use calmer endings.');
    expect(context.voiceProfile.communicationStyle).toContain('Lesson: Concrete openings feel more native to the operator than abstract framing.');
    expect(context.memory.identityConstraints.some((item) => item.includes('Concrete openings feel more native'))).toBe(true);
    expect(directiveRules.filter((rule) => rule.status === 'active')).toHaveLength(2);
    expect(context.recentPosts).toContain('already queued tweet');
    expect(context.style.exploration.rate).toBe(35);
    expect(context.style.exploration.underusedFormats).toContain('question');
    expect(context.style.banditPolicy?.formatArms.length).toBeGreaterThan(0);
    expect(context.style.banditPolicy?.summary.some((entry) => entry.startsWith('Explore format:'))).toBe(true);
  });

  it('stops injecting stale wizard style once live learnings are established', async () => {
    const agent = await createAgent({
      handle: 'context-agent-2',
      name: 'Context Agent 2',
      soulMd: '# SOUL\n\nConfident.',
    } as any);

    await saveStyleSignals(agent.id, {
      sentenceLength: 'long',
      vocabulary: 'technical',
      toneMarkers: ['dense'],
      topicPreferences: ['AI'],
      rawExtraction: 'Old wizard style',
    });

    await saveAnalysis(agent.id, {
      agentId: agent.id,
      analyzedAt: new Date().toISOString(),
      tweetCount: 10,
      viralTweets: [],
      engagementPatterns: {
        avgLikes: 10,
        avgRetweets: 2,
        avgReplies: 1,
        avgImpressions: 500,
        topHours: [14],
        topFormats: ['hot_take'],
        topTopics: ['AI'],
        viralThreshold: 30,
      },
      followingProfile: {
        totalFollowing: 10,
        topAccounts: [],
        categories: [],
      },
      contentFingerprint: 'fingerprint',
    });

    await saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 12,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: ['Use sharper openings'],
      sourceBreakdown: {
        autopilot: 12,
        manual: 0,
        timeline: 0,
        trainingCount: 12,
        trainingSource: 'autopilot',
      },
    });

    const context = await buildGenerationContext(agent);
    expect(context.voiceProfile.communicationStyle).not.toContain('Old wizard style');
  });

  it('injects high-performing operator-written tweets as a voice reference', async () => {
    const agent = await createAgent({
      handle: 'context-agent-3',
      name: 'Context Agent 3',
      soulMd: '# SOUL\n\nDirect.',
    } as any);

    await saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 24,
      avgLikes: 18,
      avgRetweets: 3,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint: {
        avgLength: 220,
        shortPct: 40,
        mediumPct: 50,
        longPct: 10,
        questionRatio: 10,
        usesLineBreaks: true,
        usesEmojis: false,
        usesNumbers: false,
        topHooks: ['bold_claim'],
        topTones: ['analytical'],
        antiPatterns: [],
        updatedAt: new Date().toISOString(),
      },
      operatorVoiceReference: {
        sampleCount: 8,
        bestPerformers: [
          {
            tweetId: '',
            xTweetId: 'manual-1',
            content: 'manual killer opener\\n\\nsharp second line that lands hard',
            format: 'hot_take',
            topic: 'AI',
            postedAt: new Date().toISOString(),
            checkedAt: new Date().toISOString(),
            likes: 120,
            retweets: 8,
            replies: 3,
            impressions: 5000,
            engagementRate: 2.62,
            wasViral: true,
            source: 'timeline',
            hook: 'bold_claim',
            tone: 'analytical',
            specificity: 'concrete',
          },
        ],
        styleFingerprint: {
          avgLength: 180,
          shortPct: 70,
          mediumPct: 30,
          longPct: 0,
          questionRatio: 25,
          usesLineBreaks: true,
          usesEmojis: false,
          usesNumbers: false,
          topHooks: ['bold_claim', 'callout'],
          topTones: ['analytical', 'provocative'],
          antiPatterns: [],
          updatedAt: new Date().toISOString(),
        },
      },
      manualTopicProfile: [
        {
          topic: 'ai',
          angle: 'AI distribution is moving from model quality to workflow leverage',
          weight: 12,
          sampleCount: 4,
          avgEngagement: 92,
          topTweets: [],
        },
      ],
      sourceBreakdown: {
        autopilot: 16,
        manual: 0,
        timeline: 8,
        trainingCount: 16,
        trainingSource: 'autopilot',
      },
    });

    const context = await buildGenerationContext(agent);
    expect(context.voiceProfile.communicationStyle).toContain('## OPERATOR VOICE REFERENCE');
    expect(context.voiceProfile.communicationStyle).toContain('Derived from 8 manually posted or operator-written tweets.');
    expect(context.voiceProfile.communicationStyle).toContain('Best human tones: analytical, provocative');
    expect(context.voiceProfile.communicationStyle).toContain('manual killer opener');
    expect(context.voiceProfile.communicationStyle).toContain('## MANUAL TOPIC PRIORS');
    expect(context.voiceProfile.communicationStyle).toContain('AI distribution is moving from model quality to workflow leverage');
  });

  it('injects a quality-aware thesis bank into generation context', async () => {
    const agent = await createAgent({
      handle: 'context-agent-ideas',
      name: 'Context Agent Ideas',
      soulMd: '# SOUL\n\nSpecific AI operator lessons.',
    } as any);

    const proven = await createTweet({
      agentId: agent.id,
      content: 'Agent memory eval loops compound faster than dashboards when every correction trains the next release.',
      type: 'original',
      status: 'posted',
      format: 'analysis',
      topic: 'AI agents',
      xTweetId: 'x-proven-idea',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'agent memory eval loops compound faster than dashboards',
    });
    await createTweet({
      agentId: agent.id,
      content: 'Agent memory eval loops compound faster than dashboards when every correction trains the next release.',
      type: 'original',
      status: 'queued',
      format: 'analysis',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'agent memory eval loops compound faster than dashboards',
    });
    const rejected = await createTweet({
      agentId: agent.id,
      content: 'AI agents replace every employee once companies wire them into Slack.',
      type: 'original',
      status: 'queued',
      format: 'hot_take',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'ai agents replace every employee',
    });
    await markIdeaAtomRejectedForTweet(rejected, 'Overclaimed and not tasteful');

    await saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 1,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      sourceBreakdown: {
        autopilot: 1,
        manual: 0,
        timeline: 0,
        trainingCount: 1,
        trainingSource: 'autopilot',
      },
    });

    await saveFeedback(agent.id, {
      tweetId: 'bad-agent-idea',
      tweetText: 'AI agents replace every employee once companies wire them into Slack.',
      rating: 'down',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Overclaimed and not tasteful',
      source: 'queue_delete',
      userProvidedReason: true,
    });

    await createTweet({
      agentId: agent.id,
      content: 'AI agents replace every employee once companies wire them into Slack.',
      type: 'original',
      status: 'queued',
      format: 'hot_take',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'ai agents replace every employee',
    });

    const context = await buildGenerationContext(agent);

    expect(context.voiceProfile.communicationStyle).toContain('## IDEA GRAPH / THESIS BANK');
    expect(context.voiceProfile.communicationStyle).toContain('[proven');
    expect(context.voiceProfile.communicationStyle).toContain(proven.thesis);
    expect(context.voiceProfile.communicationStyle).toContain('Rework or avoid:');
    expect(context.memory.referenceBank).toContain(proven.thesis);
    expect(context.memory.referenceBank).not.toContain('ai agents replace every employee');
  });

  it('injects outcome fatigue lessons for high-confidence shapes that underperform', async () => {
    const agent = await createAgent({
      handle: 'context-agent-fatigue',
      name: 'Context Agent Fatigue',
      soulMd: '# SOUL\n\nTasteful AI operator notes.',
    } as any);

    await createTweet({
      agentId: agent.id,
      content: 'AI agents only compound when the eval loop catches bad memory before it reaches users.',
      type: 'original',
      status: 'posted',
      format: 'hot_take',
      topic: 'AI agents',
      xTweetId: 'x-fatigue-1',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      predictedEngagementScore: 0.82,
      rewardPrediction: 0.76,
      hookType: 'bold_claim',
      toneType: 'analytical',
      specificityType: 'concrete',
      structureType: 'single_punch',
      thesis: 'eval loop catches bad memory before users',
      rewardBreakdown: {
        approval: 0.8,
        editBurden: 0,
        deletionPenalty: 0,
        postingOutcome: 0.3,
        copySignal: 0,
        replyOutcome: 0,
        timeToApproval: 0,
        engagementLift: -0.34,
        immediateTotal: 1,
        delayedTotal: -0.42,
        total: 0.58,
        computedAt: '2026-05-25T00:00:00.000Z',
        notes: ['Strong approval but poor engagement after posting.'],
      },
    });

    const context = await buildGenerationContext(agent);

    expect(context.memory.outcomeFatigueLessons?.[0]).toContain('Outcome fatigue: hot_take on AI agents');
    expect(context.memory.outcomeFatigueLessons?.[0]).toContain('eval loop catches bad memory before users');
    expect(context.voiceProfile.communicationStyle).toContain('## OUTCOME FATIGUE MEMORY');
    expect(context.voiceProfile.communicationStyle).toContain('Avoid repeating the same shape');
  });
});
