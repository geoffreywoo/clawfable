import { describe, expect, it, vi } from 'vitest';
import {
  addPerformanceEntry,
  createAgent,
  createTweet,
  getProtocolSettings,
  updateProtocolSettings,
  updateManualExampleCuration,
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

import { autoAdjustSettings, buildLearnings } from '@/lib/performance';

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
    hook: String(overrides.hook || 'bold_claim'),
    tone: String(overrides.tone || 'analytical'),
    specificity: String(overrides.specificity || 'concrete'),
  };
}

describe('performance learning smoke', () => {
  it('builds autonomous policy learnings from autopilot history once enough data exists', async () => {
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

    expect(learnings.sourceBreakdown?.trainingSource).toBe('autopilot');
    expect(learnings.sourceBreakdown?.autopilot).toBe(10);
    expect(learnings.sourceBreakdown?.timeline).toBe(3);
    expect(learnings.formatRankings.map((entry) => entry.format)).toEqual(['hot_take']);
    expect(learnings.bestPerformers.every((entry) => entry.source === 'autopilot')).toBe(true);
    expect(learnings.operatorVoiceReference?.sampleCount).toBe(3);
    expect(learnings.operatorVoiceReference?.bestPerformers[0]?.source).toBe('timeline');
    expect(learnings.operatorVoiceReference?.styleFingerprint.topHooks).toContain('bold_claim');
    expect(learnings.operatorVoiceReference?.styleFingerprint.topTones).toContain('analytical');
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
    }) as any);

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
  });
});
