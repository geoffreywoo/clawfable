import { describe, expect, it } from 'vitest';
import {
  buildPostPortfolioPlan,
  buildRelationshipOpportunities,
  buildTrendOpportunities,
  buildVelocityFollowupFallback,
  buildViralityPostmortem,
  inferMediaExperimentType,
  inferPortfolioRole,
  mineReplyInsights,
  shouldCreateVelocityFollowup,
} from '@/lib/growth-engine';
import type { EnrichedTrendingTopic } from '@/lib/source-planner';
import type { Mention, PostLogEntry, TweetPerformance } from '@/lib/types';

function perf(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: 't1',
    xTweetId: 'x1',
    content: 'Most founders confuse attention with leverage.',
    format: 'hot_take',
    topic: 'startups',
    postedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
    likes: 18,
    retweets: 2,
    replies: 3,
    impressions: 600,
    engagementRate: 3.83,
    wasViral: false,
    source: 'autopilot',
    performanceCheckpoint: 'early_30m',
    earlyVelocityScore: 0.7,
    ...overrides,
  };
}

describe('growth-engine', () => {
  it('builds a varied portfolio plan with media and relationship slots', () => {
    const roles = buildPostPortfolioPlan({ count: 7, settings: { mediaExperimentRate: 20 } });

    expect(new Set(roles).size).toBeGreaterThan(3);
    expect(roles).toContain('media');
    expect(roles).toContain('relationship');
  });

  it('infers portfolio and media experiments from draft shape', () => {
    expect(inferPortfolioRole({
      content: 'Most people are wrong about AI agents because they optimize demos, not reliability.',
      creativeLane: 'contrarian_angle',
      format: 'hot_take',
    })).toBe('contrarian');

    expect(inferMediaExperimentType({
      content: 'Here is the dashboard screenshot that changed how I think about retention.',
      portfolioRole: 'media',
    })).toBe('screenshot');
  });

  it('converts accepted trends into supervised opportunities', () => {
    const topic: EnrichedTrendingTopic = {
      id: 1,
      headline: 'AI agents are moving into back-office workflows',
      source: '@builder',
      relevanceScore: 92,
      category: 'agents',
      timestamp: new Date().toISOString(),
      tweetCount: 4,
      topTweet: { id: 'x2', text: 'AI agents are everywhere now', likes: 100, author: 'builder' },
      fitScores: { freshness: 0.9, velocity: 0.8, soul: 0.7, manual: 0.6, total: 0.75 },
      sourceLane: 'trend_aligned_exploit',
      plannerReason: 'Hot trend with strong fit.',
    };

    const opportunities = buildTrendOpportunities('agent-1', [topic]);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].fitScore).toBe(0.75);
    expect(opportunities[0].topTweetAuthor).toBe('builder');
  });

  it('mines reply questions and relationship opportunities', () => {
    const mentions: Mention[] = [{
      id: 'm1',
      agentId: 'agent-1',
      author: 'A Builder',
      authorHandle: 'builder',
      content: 'Can you give a concrete example of this?',
      tweetId: 'x3',
      conversationId: null,
      inReplyToTweetId: null,
      engagementLikes: 5,
      engagementRetweets: 1,
      createdAt: new Date().toISOString(),
    }];
    const postLog: PostLogEntry[] = [];

    expect(mineReplyInsights(mentions)[0].theme).toBe('requested explanation');
    expect(buildRelationshipOpportunities({
      agentId: 'agent-1',
      mentions,
      postLog,
      performanceHistory: [perf()],
    })[0].suggestedAction).toBe('reply');
  });

  it('detects velocity follow-up opportunities and builds postmortems', () => {
    const entry = perf();

    expect(shouldCreateVelocityFollowup(entry)).toBe(true);
    expect(buildVelocityFollowupFallback(entry)).toContain('The');

    const postmortem = buildViralityPostmortem('agent-1', entry);
    expect(postmortem.performanceSummary).toContain('18 likes');
    expect(postmortem.nextExperiments.length).toBeGreaterThan(0);
  });
});
