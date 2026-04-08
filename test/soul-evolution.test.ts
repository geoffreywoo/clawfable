import { describe, expect, it, vi } from 'vitest';
import {
  addVoiceDirective,
  createAgent,
  saveFeedback,
  saveLearnings,
  updateProtocolSettings,
} from '@/lib/kv-storage';

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(async () => ({
    content: [{
      type: 'text',
      text: `# SOUL.md

I am sharper now, more concrete, and more specific about what matters.

## 1) Objective Function
Primary objective: Say specific things with concrete observations, strong evidence, and less generic filler.

## 2) Communication Protocol
Default output: Lead with specifics, avoid vague abstractions, and stay tightly aligned with the operator's preferred voice.

CHANGES: tightened the voice around concrete, higher-signal writing`,
    }],
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: createMock,
    };
  },
}));

import { maybeEvolveSoul } from '@/lib/soul-evolution';

describe('soul evolution smoke', () => {
  it('feeds operator directives and rejections into soul evolution', async () => {
    const agent = await createAgent({
      handle: 'soul-evolution-agent',
      name: 'Soul Evolution Agent',
      soulMd: `# SOUL.md

I am an agent with a sufficiently long current soul so evolution is allowed.

## 1) Objective Function
Primary objective: Write thoughtful tweets.`,
    } as any);

    await updateProtocolSettings(agent.id, { soulEvolutionMode: 'approval' });
    await addVoiceDirective(agent.id, 'Lead with concrete observations.');
    await saveFeedback(agent.id, {
      tweetId: 'reject-1',
      tweetText: 'generic filler tweet',
      rating: 'down',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Too generic',
      source: 'queue_delete',
      userProvidedReason: true,
    });
    await saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 60,
      avgLikes: 20,
      avgRetweets: 5,
      bestPerformers: [{
        tweetId: 'best-1',
        xTweetId: 'x-best-1',
        content: 'best tweet',
        format: 'hot_take',
        topic: 'AI',
        postedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        likes: 100,
        retweets: 10,
        replies: 5,
        impressions: 1000,
        engagementRate: 11.5,
        wasViral: true,
        source: 'autopilot',
      }],
      worstPerformers: [{
        tweetId: 'worst-1',
        xTweetId: 'x-worst-1',
        content: 'worst tweet',
        format: 'observation',
        topic: 'AI',
        postedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        likes: 1,
        retweets: 0,
        replies: 0,
        impressions: 1000,
        engagementRate: 0.1,
        wasViral: false,
        source: 'autopilot',
      }],
      formatRankings: [{ format: 'hot_take', avgEngagement: 110, count: 10 }],
      topicRankings: [{ topic: 'AI', avgEngagement: 110, count: 10 }],
      insights: ['Use sharper hooks'],
      styleFingerprint: {
        avgLength: 180,
        shortPct: 70,
        mediumPct: 20,
        longPct: 10,
        questionRatio: 20,
        usesLineBreaks: false,
        usesEmojis: false,
        usesNumbers: true,
        topHooks: ['bold_claim'],
        topTones: ['analytical'],
        antiPatterns: ['Generic openings underperform'],
        updatedAt: new Date().toISOString(),
      },
      sourceBreakdown: {
        autopilot: 60,
        manual: 0,
        timeline: 0,
        trainingCount: 60,
        trainingSource: 'autopilot',
      },
    });

    const result = await maybeEvolveSoul(agent);

    expect(result.evolved).toBe(false);
    expect(result.reason).toContain('awaiting approval');
    expect(result.changeSummary).toContain('tightened the voice');
    expect(createMock).toHaveBeenCalled();
    const prompt = String((createMock as any).mock.calls?.[0]?.[0]?.messages?.[0]?.content || '');
    expect(prompt).toContain('Lead with concrete observations.');
    expect(prompt).toContain('Lesson: Concrete openings feel more native to the operator than abstract framing.');
    expect(prompt).toContain('generic filler tweet (why it was rejected: Too generic)');
  });
});
