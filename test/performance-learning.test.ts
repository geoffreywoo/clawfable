import { describe, expect, it, vi } from 'vitest';
import {
  addPerformanceEntry,
  createAgent,
  createTweet,
  getProtocolSettings,
  updateProtocolSettings,
  updateManualExampleCuration,
  addLearningSignal,
} from '@/lib/kv-storage';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: '- Use sharper hooks\n- Stop posting vague takes' }],
      })),
    };
  },
}));

import {
  autoAdjustSettings,
  buildLearnings,
  formatLearningInsightTweetExample,
  formatTweetClassificationList,
  formatVelocityFollowupPostForPrompt,
  formatVelocityFollowupSoulForPrompt,
  getLearningInsightMaxTokens,
  getLearningInsightPromptLimits,
  getTweetClassificationMaxTokens,
  getVelocityFollowupMaxTokens,
} from '@/lib/performance';

function performanceEntry(overrides: Record<string, unknown>) {
  return {
    tweetId: String(overrides.tweetId || ''),
    xTweetId: String(overrides.xTweetId || Math.random()),
    content: String(overrides.content || 'tweet'),
    format: String(overrides.format || 'hot_take'),
    topic: String(overrides.topic || 'AI'),
    postedAt: '2026-04-01T00:00:00.000Z',
    checkedAt: '2026-04-01T01:00:00.000Z',
    likes: Number(overrides.likes ?? 10),
    retweets: Number(overrides.retweets ?? 2),
    replies: Number(overrides.replies ?? 1),
    impressions: Number(overrides.impressions ?? 100),
    engagementRate: Number(overrides.engagementRate ?? 13),
    wasViral: Boolean(overrides.wasViral ?? false),
    source: (overrides.source || 'autopilot') as 'autopilot' | 'manual' | 'timeline',
    styleMode: (overrides.styleMode || 'standard') as 'standard' | 'shitpoast',
    hook: String(overrides.hook || 'bold_claim'),
    tone: String(overrides.tone || 'analytical'),
    specificity: String(overrides.specificity || 'concrete'),
  };
}

describe('performance learning smoke', () => {
  it('budgets learning insight prompt examples by history size', () => {
    expect(getLearningInsightPromptLimits(8)).toEqual({ rankingRows: 4, examples: 4, textChars: 180 });
    expect(getLearningInsightPromptLimits(20)).toEqual({ rankingRows: 6, examples: 6, textChars: 220 });
    expect(getLearningInsightPromptLimits(40)).toEqual({ rankingRows: 8, examples: 8, textChars: 250 });
    expect(getLearningInsightMaxTokens(8)).toBe(768);
    expect(getLearningInsightMaxTokens(20)).toBe(1024);
  });

  it('compacts tweet examples for learning insight prompts', () => {
    const line = formatLearningInsightTweetExample(performanceEntry({
      tweetId: 'long-example',
      content: `AI agent evals ${'need visible rollback proof '.repeat(20)}FINAL_LEARNING_SENTINEL`,
      likes: 42,
      retweets: 7,
      source: 'manual',
    }) as any, 120);

    expect(line).toContain('[42 likes, 7 RTs, source:manual]');
    expect(line).toContain('AI agent evals');
    expect(line).not.toContain('FINAL_LEARNING_SENTINEL');
    expect(line).toContain('...');
  });

  it('budgets tweet classification completions by batch size', () => {
    expect(getTweetClassificationMaxTokens(1)).toBe(768);
    expect(getTweetClassificationMaxTokens(5)).toBe(768);
    expect(getTweetClassificationMaxTokens(10)).toBe(1280);
    expect(getTweetClassificationMaxTokens(20)).toBe(2048);
  });

  it('compacts tweet text for classification prompts', () => {
    const list = formatTweetClassificationList([
      {
        id: 'long-classification',
        text: `AI agent evals ${'need visible rollback proof '.repeat(20)}FINAL_CLASSIFICATION_SENTINEL`,
      },
    ]);

    expect(list).toContain('[0] "AI agent evals');
    expect(list).toContain('...');
    expect(list).not.toContain('FINAL_CLASSIFICATION_SENTINEL');
  });

  it('budgets velocity follow-up prompt context and completion size', () => {
    const soul = formatVelocityFollowupSoulForPrompt(`# soul\n${'voice detail '.repeat(140)}SOUL_SENTINEL`);
    const post = formatVelocityFollowupPostForPrompt(`core post ${'argument detail '.repeat(160)}POST_SENTINEL`);

    expect(soul.length).toBeLessThan(1050);
    expect(soul).not.toContain('SOUL_SENTINEL');
    expect(post.length).toBeLessThan(1250);
    expect(post).toContain('core post');
    expect(post).not.toContain('POST_SENTINEL');
    expect(getVelocityFollowupMaxTokens(120)).toBe(256);
    expect(getVelocityFollowupMaxTokens(600)).toBe(384);
    expect(getVelocityFollowupMaxTokens(1600)).toBe(512);
  });

  it('blends successful operator timeline posts into policy learning alongside autopilot history', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-1',
      name: 'Perf Agent 1',
      soulMd: '# soul',
    } as any);

    for (let i = 0; i < 10; i++) {
      await addPerformanceEntry(agent.id, performanceEntry({
        tweetId: `auto-${i}`,
        xTweetId: `x-auto-${i}`,
        content: `autopilot tweet ${i}`,
        format: 'hot_take',
        topic: 'AI',
        likes: 20 + i,
        source: 'autopilot',
      }) as any);
    }

    for (let i = 0; i < 3; i++) {
      await addPerformanceEntry(agent.id, performanceEntry({
        tweetId: `manual-${i}`,
        xTweetId: `x-manual-${i}`,
        content: `manual tweet ${i}`,
        format: 'question',
        topic: 'Crypto',
        likes: 200 + i,
        source: 'timeline',
      }) as any);
    }

    const learnings = await buildLearnings(agent);

    expect(learnings.sourceBreakdown?.trainingSource).toBe('mixed');
    expect(learnings.sourceBreakdown?.autopilot).toBe(10);
    expect(learnings.sourceBreakdown?.timeline).toBe(3);
    expect(learnings.formatRankings.map((entry) => entry.format)).toEqual(expect.arrayContaining(['hot_take', 'question']));
    expect(learnings.bestPerformers.some((entry) => entry.source === 'timeline')).toBe(true);
    expect(learnings.operatorVoiceReference?.sampleCount).toBe(3);
    expect(learnings.operatorVoiceReference?.bestPerformers[0]?.source).toBe('timeline');
    expect(learnings.operatorVoiceReference?.styleFingerprint.topHooks).toContain('bold_claim');
    expect(learnings.operatorVoiceReference?.styleFingerprint.topTones).toContain('analytical');
  });

  it('never lets generated winners define the native style fingerprint once manual evidence exists', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-native-fingerprint',
      name: 'Perf Agent Native Fingerprint',
      soulMd: '# soul',
    } as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: 'auto-viral',
      xTweetId: 'x-auto-viral',
      content: 'Polished generated framework. '.repeat(20),
      likes: 5000,
      source: 'autopilot',
      hook: 'question',
      tone: 'hype',
    }) as any);
    const manualContent = 'bro.. packaging yield is where the chip roadmap meets the factory';
    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: 'manual-native',
      xTweetId: 'x-manual-native',
      content: manualContent,
      likes: 80,
      source: 'timeline',
      hook: 'callout',
      tone: 'provocative',
    }) as any);

    const learnings = await buildLearnings(agent);

    expect(learnings.styleFingerprint?.avgLength).toBe(manualContent.length);
    expect(learnings.styleFingerprint?.topHooks).toEqual(['callout']);
    expect(learnings.styleFingerprint?.topTones).toEqual(['provocative']);
  });

  it('excludes blocked manual posts from every native anchor surface even if they were pinned', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-blocked-anchor',
      name: 'Perf Agent Blocked Anchor',
      soulMd: '# soul',
    } as any);

    await updateManualExampleCuration(agent.id, {
      pinnedXTweetIds: ['x-blocked-anchor'],
      blockedXTweetIds: ['x-blocked-anchor'],
    });
    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: 'blocked-anchor',
      xTweetId: 'x-blocked-anchor',
      content: 'Generic AI launch advice that should never become a voice anchor.',
      topic: 'AI launch advice',
      likes: 1000,
      source: 'timeline',
    }) as any);
    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: 'native-anchor',
      xTweetId: 'x-native-anchor',
      content: 'HBM bandwidth is useless if rack power closes the deployment window.',
      topic: 'inference infrastructure',
      likes: 100,
      source: 'timeline',
    }) as any);

    const learnings = await buildLearnings(agent);
    const anchorIds = learnings.operatorVoiceReference?.bestPerformers.map((tweet) => tweet.xTweetId) || [];
    const manualIds = learnings.manualTopicProfile?.flatMap((cluster) => cluster.topTweets.map((tweet) => tweet.xTweetId)) || [];

    expect(learnings.manualExampleCuration?.pinnedXTweetIds).not.toContain('x-blocked-anchor');
    expect(anchorIds).not.toContain('x-blocked-anchor');
    expect(manualIds).not.toContain('x-blocked-anchor');
  });

  it('treats manually posted Clawfable tweets as high-signal voice and topic training', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-manual-signal',
      name: 'Perf Agent Manual Signal',
      soulMd: '# soul',
    } as any);

    for (let i = 0; i < 10; i++) {
      await addPerformanceEntry(agent.id, performanceEntry({
        tweetId: `auto-${i}`,
        xTweetId: `x-auto-${i}`,
        content: `autopilot infrastructure tweet ${i}`,
        format: 'analysis',
        topic: 'Infra',
        likes: 32,
        retweets: 2,
        replies: 1,
        source: 'autopilot',
      }) as any);
    }

    const manualTweet = await createTweet({
      agentId: agent.id,
      content: 'Biohacking got interesting when it stopped being supplement theater and became instrumentation.',
      type: 'original',
      status: 'posted',
      format: 'hot_take',
      topic: 'Biohacking',
      xTweetId: 'x-manual-posted',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    await addLearningSignal(agent.id, {
      tweetId: manualTweet.id,
      xTweetId: 'x-manual-posted',
      signalType: 'x_post_succeeded',
      surface: 'manual_post',
      rewardDelta: 0.72,
    });

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: manualTweet.id,
      xTweetId: 'x-manual-posted',
      content: manualTweet.content,
      format: 'hot_take',
      topic: 'Biohacking',
      likes: 44,
      retweets: 4,
      replies: 3,
      source: 'autopilot',
      hook: 'bold_claim',
      tone: 'provocative',
      specificity: 'concrete',
    }) as any);

    const learnings = await buildLearnings(agent);

    expect(learnings.sourceBreakdown?.manual).toBe(1);
    expect(learnings.sourceBreakdown?.trainingSource).toBe('mixed');
    expect(learnings.formatRankings[0]?.format).toBe('hot_take');
    expect(learnings.topicRankings[0]?.topic).toBe('Biohacking');
    expect(learnings.bestPerformers[0]?.source).toBe('manual');
    expect(learnings.operatorVoiceReference?.sampleCount).toBe(1);
    expect(learnings.operatorVoiceReference?.bestPerformers[0]?.xTweetId).toBe('x-manual-posted');
    expect(learnings.operatorVoiceReference?.styleFingerprint.topTones).toContain('provocative');
  });

  it('only auto-tunes settings when the training set is truly autopilot-backed', async () => {
    const mixedAgent = await createAgent({
      handle: 'perf-agent-2',
      name: 'Perf Agent 2',
      soulMd: '# soul',
    } as any);

    await autoAdjustSettings(mixedAgent.id, {
      agentId: mixedAgent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 20,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [
        performanceEntry({ content: 'short', likes: 50, format: 'hot_take' }) as any,
      ],
      worstPerformers: [
        performanceEntry({ content: 'x'.repeat(600), likes: 1, format: 'analysis' }) as any,
      ],
      formatRankings: [
        { format: 'hot_take', avgEngagement: 50, count: 3 },
        { format: 'analysis', avgEngagement: 40, count: 3 },
        { format: 'question', avgEngagement: 35, count: 3 },
        { format: 'data_point', avgEngagement: 30, count: 3 },
      ],
      topicRankings: [],
      insights: ['Rule'],
      sourceBreakdown: {
        autopilot: 4,
        manual: 8,
        timeline: 8,
        trainingCount: 20,
        trainingSource: 'mixed',
      },
    });

    const unchanged = await getProtocolSettings(mixedAgent.id);
    expect(unchanged.enabledFormats).toEqual([]);
    expect(unchanged.lengthMix).toEqual({ short: 30, medium: 30, long: 40 });

    const autopilotAgent = await createAgent({
      handle: 'perf-agent-3',
      name: 'Perf Agent 3',
      soulMd: '# soul',
    } as any);
    await updateProtocolSettings(autopilotAgent.id, { enabledFormats: [] });

    await autoAdjustSettings(autopilotAgent.id, {
      agentId: autopilotAgent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 20,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [
        performanceEntry({ content: 'short strong', likes: 50, format: 'hot_take' }) as any,
        performanceEntry({ content: 'medium'.repeat(40), likes: 30, format: 'question' }) as any,
      ],
      worstPerformers: [
        performanceEntry({ content: 'x'.repeat(800), likes: 1, format: 'analysis' }) as any,
        performanceEntry({ content: 'y'.repeat(850), likes: 1, format: 'observation' }) as any,
      ],
      formatRankings: [
        { format: 'hot_take', avgEngagement: 50, count: 3 },
        { format: 'question', avgEngagement: 45, count: 3 },
        { format: 'data_point', avgEngagement: 40, count: 3 },
        { format: 'observation', avgEngagement: 35, count: 3 },
        { format: 'analysis', avgEngagement: 5, count: 3 },
      ],
      topicRankings: [],
      insights: ['Rule'],
      sourceBreakdown: {
        autopilot: 20,
        manual: 0,
        timeline: 0,
        trainingCount: 20,
        trainingSource: 'autopilot',
      },
    });

    const updated = await getProtocolSettings(autopilotAgent.id);
    expect(updated.enabledFormats).toEqual([]);
    expect(updated.lengthMix.short).toBeGreaterThan(updated.lengthMix.long);
  });

  it('dedupes repeated performance snapshots before learning from manual winners', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-4',
      name: 'Perf Agent 4',
      soulMd: '# soul',
    } as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-dup-1',
      content: 'duplicate hit tweet',
      format: 'hot_take',
      topic: 'AI',
      likes: 110,
      replies: 9,
      source: 'timeline',
      checkedAt: '2026-04-01T01:00:00.000Z',
    }) as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-dup-1',
      content: 'duplicate hit tweet',
      format: 'hot_take',
      topic: 'AI',
      likes: 140,
      replies: 12,
      source: 'timeline',
      checkedAt: '2026-04-01T03:00:00.000Z',
    }) as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-unique-2',
      content: 'second manual winner',
      format: 'question',
      topic: 'AI',
      likes: 95,
      source: 'timeline',
    }) as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-unique-3',
      content: 'third manual winner',
      format: 'observation',
      topic: 'AI',
      likes: 80,
      source: 'timeline',
    }) as any);

    const learnings = await buildLearnings(agent);
    const bestIds = learnings.operatorVoiceReference?.bestPerformers.map((entry) => entry.xTweetId) ?? [];

    expect(learnings.totalTracked).toBe(3);
    expect(learnings.operatorVoiceReference?.sampleCount).toBe(3);
    expect(learnings.operatorVoiceReference?.bestPerformers[0]?.likes).toBe(140);
    expect(new Set(bestIds).size).toBe(bestIds.length);
  });

  it('does not let a high-engagement media stub displace substantive native voice anchors', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-substantive-anchors',
      name: 'Perf Agent Substantive Anchors',
      soulMd: '# soul',
    } as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      xTweetId: 'x-media-stub',
      content: 'inevitable https://video.example/demo',
      format: 'announcement',
      likes: 50_000,
      retweets: 5_000,
      source: 'timeline',
    }) as any);

    const substantiveExamples = [
      'The constraint in this factory is not demand. It is qualifying one more process without breaking yield.',
      'software is nepo plus codex. hardware is where the remaining alpha still looks mispriced.',
      'is the AI stock trade melting because everyone decided to spend the summer in europe?',
      'threshold to beat is QQQ. mid market private equity still looks like a building full of zombies.',
      'compute pricing is an actually useful prediction market because the underlying capacity clears continuously.',
      'the harness and context are at least half the product. model quality alone does not explain adoption.',
      'buy more AI stocks or chill? the local fear looks temporary, but conviction gets expensive on red days.',
      'factory qualification is a social technology disguised as paperwork. every supplier change reopens the argument.',
    ];
    for (let index = 0; index < substantiveExamples.length; index++) {
      await addPerformanceEntry(agent.id, performanceEntry({
        xTweetId: `x-substantive-${index}`,
        content: substantiveExamples[index],
        format: index % 2 === 0 ? 'observation' : 'hot_take',
        likes: 20 - index,
        source: 'timeline',
      }) as any);
    }

    const learnings = await buildLearnings(agent);
    const bestIds = learnings.operatorVoiceReference?.bestPerformers.map((entry) => entry.xTweetId) ?? [];

    expect(bestIds).toHaveLength(8);
    expect(bestIds).not.toContain('x-media-stub');
    expect(bestIds.every((id) => id.startsWith('x-substantive-'))).toBe(true);
  });

  it('collapses near-duplicate manual posts before building the native voice bank', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-anchor-dedupe',
      name: 'Perf Agent Anchor Dedupe',
      soulMd: '# soul',
    } as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      xTweetId: 'x-interview-primary',
      content: 'New interview with the team about sports, investments, and venture capital. Six years ago none of our athlete friends had heard of venture capital.',
      likes: 120,
      source: 'timeline',
    }) as any);
    await addPerformanceEntry(agent.id, performanceEntry({
      xTweetId: 'x-interview-duplicate',
      content: 'New interview with the team about the intersection of sports, business, and venture capital. Six years ago none of our athlete friends knew anything about venture capital.',
      likes: 90,
      source: 'timeline',
    }) as any);

    const distinctExamples = [
      'software is nepo plus codex. hardware is where the remaining alpha still looks mispriced.',
      'is the AI stock trade melting because everyone decided to spend the summer in europe?',
      'threshold to beat is QQQ. mid market private equity still looks like a building full of zombies.',
      'compute pricing is an actually useful prediction market because the underlying capacity clears continuously.',
      'the harness and context are at least half the product. model quality alone does not explain adoption.',
      'buy more AI stocks or chill? the local fear looks temporary, but conviction gets expensive on red days.',
      'factory qualification is a social technology disguised as paperwork. every supplier change reopens the argument.',
    ];
    for (let index = 0; index < distinctExamples.length; index++) {
      await addPerformanceEntry(agent.id, performanceEntry({
        xTweetId: `x-distinct-${index}`,
        content: distinctExamples[index],
        likes: 50 - index,
        source: 'timeline',
      }) as any);
    }

    const learnings = await buildLearnings(agent);
    const bestIds = learnings.operatorVoiceReference?.bestPerformers.map((entry) => entry.xTweetId) ?? [];

    expect(bestIds).toHaveLength(8);
    expect(bestIds).toContain('x-interview-primary');
    expect(bestIds).not.toContain('x-interview-duplicate');
  });

  it('stores manual topic priors, curation metadata, and source-lane performance', async () => {
    const agent = await createAgent({
      handle: 'perf-agent-5',
      name: 'Perf Agent 5',
      soulMd: '# soul',
    } as any);

    await updateManualExampleCuration(agent.id, {
      pinnedXTweetIds: ['x-pin'],
      blockedXTweetIds: ['x-block'],
    });

    const manualCoreTweet = await createTweet({
      agentId: agent.id,
      content: 'Clawfable autopilot post about AI leverage',
      type: 'original',
      status: 'posted',
      topic: 'AI',
      xTweetId: 'x-live-1',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      sourceLane: 'manual_core_exploit',
    });

    const trendTweet = await createTweet({
      agentId: agent.id,
      content: 'Trend-aware autopilot post about model infra',
      type: 'original',
      status: 'posted',
      topic: 'AI',
      xTweetId: 'x-live-2',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      sourceLane: 'trend_aligned_exploit',
      styleMode: 'shitpoast',
      trendTopicId: 'trend-42',
      trendHeadline: 'Model infra momentum',
    });

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: manualCoreTweet.id,
      xTweetId: 'x-live-1',
      content: 'Clawfable autopilot post about AI leverage',
      topic: 'AI',
      likes: 44,
      retweets: 4,
      replies: 3,
      source: 'autopilot',
      styleMode: 'shitpoast',
    }) as any);

    await addLearningSignal(agent.id, {
      tweetId: trendTweet.id,
      signalType: 'approved_without_edit',
      surface: 'queue',
      rewardDelta: 0.8,
      metadata: { styleMode: 'shitpoast' },
    });

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: trendTweet.id,
      xTweetId: 'x-live-2',
      content: 'Trend-aware autopilot post about model infra',
      topic: 'AI',
      likes: 36,
      retweets: 3,
      replies: 2,
      source: 'autopilot',
    }) as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-pin',
      content: 'AI distribution is shifting from raw model quality to workflow leverage.',
      format: 'hot_take',
      topic: 'AI',
      likes: 220,
      replies: 10,
      source: 'timeline',
    }) as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-core',
      content: 'Builders who own the workflow will beat builders who only own the model.',
      format: 'hot_take',
      topic: 'AI',
      likes: 160,
      replies: 8,
      source: 'timeline',
    }) as any);

    await addPerformanceEntry(agent.id, performanceEntry({
      tweetId: '',
      xTweetId: 'x-block',
      content: 'sign up for the launch now and try the product',
      format: 'announcement',
      topic: 'AI',
      likes: 400,
      replies: 2,
      source: 'timeline',
    }) as any);

    const learnings = await buildLearnings(agent);

    expect(learnings.manualExampleCuration?.pinnedXTweetIds).toContain('x-pin');
    expect(learnings.manualExampleCuration?.blockedXTweetIds).toContain('x-block');
    expect(learnings.manualTopicProfile?.map((cluster) => cluster.topic)).toContain('ai');
    expect(learnings.operatorVoiceReference?.pinnedExamples?.some((tweet) => tweet.xTweetId === 'x-pin')).toBe(true);
    expect(learnings.operatorVoiceReference?.blockedXTweetIds).toContain('x-block');
    expect(learnings.operatorVoiceReference?.bestPerformers.some((tweet) => tweet.xTweetId === 'x-block')).toBe(false);
    expect(learnings.sourceLanePerformance?.find((lane) => lane.lane === 'manual_core_exploit')?.posts).toBe(1);
    expect(learnings.sourceLanePerformance?.find((lane) => lane.lane === 'trend_aligned_exploit')?.posts).toBe(1);
    expect(learnings.styleModePerformance?.find((mode) => mode.mode === 'shitpoast')?.posts).toBe(1);
    expect(learnings.styleModePerformance?.find((mode) => mode.mode === 'shitpoast')?.approvals).toBe(1);
  });
});
