import { describe, expect, it, vi } from 'vitest';
import {
  addPerformanceEntry,
  createAgent,
  getProtocolSettings,
  updateProtocolSettings,
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
    expect(updated.enabledFormats).toEqual(['hot_take', 'question', 'data_point', 'observation']);
    expect(updated.lengthMix.short).toBeGreaterThan(updated.lengthMix.long);
  });
});
