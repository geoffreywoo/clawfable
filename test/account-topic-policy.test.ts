import { describe, expect, it } from 'vitest';
import { applyAccountLearningPolicy, applyAccountTopicPolicy, shouldSuppressTopicForAccount } from '../lib/account-topic-policy';
import type { AgentLearnings } from '../lib/types';

describe('account topic policy', () => {
  it('removes crypto without manufacturing a hard-coded replacement identity', () => {
    const profile = applyAccountTopicPolicy('@geoffwoo', {
      tone: 'analyst',
      topics: ['ai', 'crypto', 'startup'],
      antiGoals: [],
      communicationStyle: 'direct',
      summary: 'test',
    });

    expect(profile.topics).not.toContain('crypto');
    expect(profile.topics).toEqual(['ai', 'startup']);
    expect(profile.topics).not.toContain('fusion');
    expect(profile.topics).not.toContain('robotics');
    expect(profile.communicationStyle).toContain('Crypto is no longer a core content pillar');
    expect(profile.communicationStyle).toContain('Discover current subjects dynamically');
    expect(profile.communicationStyle).toContain('ACCOUNT ANTI-SLOP POLICY FOR @geoffwoo');
    expect(profile.communicationStyle).toContain('low-status SaaS-ops texture');
    expect(profile.communicationStyle).toContain('compute constraints');
    expect(profile.communicationStyle).toContain('tungsten carbide tooling');
    expect(profile.antiGoals.join(' ')).toContain('ai slop');
    expect(profile.antiGoals.join(' ')).toContain('slack channels');
  });

  it('filters crypto-only learned priors for @geoffwoo', () => {
    const learnings = {
      agentId: 'agent-1',
      updatedAt: new Date().toISOString(),
      totalTracked: 10,
      avgLikes: 1,
      avgRetweets: 1,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [
        { topic: 'crypto', avgEngagement: 100, count: 4 },
        { topic: 'robotics', avgEngagement: 20, count: 2 },
      ],
      insights: ['Post more crypto takes', 'Post more AI infrastructure takes'],
      manualTopicProfile: [
        { topic: 'crypto', angle: 'bitcoin markets', weight: 10, sampleCount: 3, avgEngagement: 100, topTweets: [] },
        { topic: 'space', angle: 'launch costs', weight: 5, sampleCount: 2, avgEngagement: 50, topTweets: [] },
      ],
    } satisfies AgentLearnings;

    const filtered = applyAccountLearningPolicy('geoffwoo', learnings);

    expect(filtered?.topicRankings.map((entry) => entry.topic)).toEqual(['robotics']);
    expect(filtered?.manualTopicProfile?.map((entry) => entry.topic)).toEqual(['space']);
    expect(filtered?.insights).toEqual(['Post more AI infrastructure takes']);
  });

  it('leaves other accounts unchanged', () => {
    const profile = {
      tone: 'analyst',
      topics: ['ai', 'crypto'],
      antiGoals: [],
      communicationStyle: 'direct',
      summary: 'test',
    };

    expect(applyAccountTopicPolicy('@someoneelse', profile)).toBe(profile);
  });

  it('suppresses crypto-only topics for both current and legacy Geoffrey handles', () => {
    expect(shouldSuppressTopicForAccount('@geoffwoo', 'crypto')).toBe(true);
    expect(shouldSuppressTopicForAccount('@geoffreywoo', 'crypto')).toBe(true);
    expect(shouldSuppressTopicForAccount('@geoffwoo', 'robotics')).toBe(false);
    expect(shouldSuppressTopicForAccount('@someoneelse', 'crypto')).toBe(false);
  });
});
