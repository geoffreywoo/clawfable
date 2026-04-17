import { describe, expect, it } from 'vitest';
import { buildBanditPolicy, buildBanditSlotPlan } from '@/lib/bandit';
import type { FeedbackEntry, Tweet, TweetPerformance } from '@/lib/types';

function arm(overrides: Partial<import('@/lib/bandit').BanditArmScore> & { arm: string; family: import('@/lib/bandit').BanditArmScore['family'] }): import('@/lib/bandit').BanditArmScore {
  return {
    arm: overrides.arm,
    family: overrides.family,
    pulls: overrides.pulls ?? 3,
    localPulls: overrides.localPulls ?? overrides.pulls ?? 3,
    globalPulls: overrides.globalPulls ?? 2,
    priorPulls: overrides.priorPulls ?? 3,
    successes: overrides.successes ?? 2,
    failures: overrides.failures ?? 1,
    meanReward: overrides.meanReward ?? 0.61,
    globalMeanReward: overrides.globalMeanReward ?? 0.57,
    explorationBonus: overrides.explorationBonus ?? 0.42,
    uncertainty: overrides.uncertainty ?? 0.21,
    alpha: overrides.alpha ?? 3,
    beta: overrides.beta ?? 2,
    ucbScore: overrides.ucbScore ?? 1.03,
    thompsonScore: overrides.thompsonScore ?? 1.01,
    coldStart: overrides.coldStart ?? false,
    source: overrides.source ?? 'mixed',
    localShare: overrides.localShare ?? 0.54,
  };
}

function performanceEntry(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: overrides.tweetId || crypto.randomUUID(),
    xTweetId: overrides.xTweetId || crypto.randomUUID(),
    content: overrides.content || 'tweet',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'AI',
    postedAt: overrides.postedAt || '2026-04-01T00:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-04-01T01:00:00.000Z',
    likes: overrides.likes ?? 10,
    retweets: overrides.retweets ?? 2,
    replies: overrides.replies ?? 1,
    impressions: overrides.impressions ?? 100,
    engagementRate: overrides.engagementRate ?? 13,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source || 'autopilot',
    hook: overrides.hook || 'bold_claim',
    tone: overrides.tone || 'analytical',
    specificity: overrides.specificity || 'concrete',
  };
}

function tweetEntry(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: overrides.id || crypto.randomUUID(),
    agentId: overrides.agentId || 'agent-1',
    content: overrides.content || 'tweet',
    type: overrides.type || 'original',
    status: overrides.status || 'queued',
    format: overrides.format ?? 'hot_take',
    topic: overrides.topic ?? 'AI',
    xTweetId: overrides.xTweetId ?? null,
    quoteTweetId: overrides.quoteTweetId ?? null,
    quoteTweetAuthor: overrides.quoteTweetAuthor ?? null,
    scheduledAt: overrides.scheduledAt ?? null,
    deletionReason: overrides.deletionReason ?? null,
    createdAt: overrides.createdAt || '2026-04-01T00:00:00.000Z',
  };
}

describe('bandit policy', () => {
  it('separates exploit leaders from cold-start exploration arms', () => {
    const performanceHistory = Array.from({ length: 12 }, (_, index) =>
      performanceEntry({
        tweetId: `hot-${index}`,
        xTweetId: `x-hot-${index}`,
        content: `hot take ${index}`,
        format: 'hot_take',
        topic: 'AI',
        likes: 40,
        retweets: 6,
        replies: 3,
      })
    ).concat([
      performanceEntry({
        tweetId: 'analysis-1',
        xTweetId: 'x-analysis-1',
        content: 'analysis miss',
        format: 'analysis',
        topic: 'Infra',
        likes: 2,
        retweets: 0,
        replies: 0,
      }),
    ]);

    const policy = buildBanditPolicy({
      performanceHistory,
      feedback: [],
      signals: [],
      allTweets: [],
      allowedFormats: ['hot_take', 'analysis', 'question'],
      candidateTopics: ['AI', 'Infra', 'Markets'],
      baseline: null,
    });

    expect(policy.trainingSource).toBe('autopilot');
    expect(policy.summary.some((entry) => entry.startsWith('Exploit format: hot_take'))).toBe(true);
    expect(policy.summary).toContain('Explore format: question');
    expect(policy.formatArms.some((arm) => arm.arm === 'hot_take' && arm.meanReward > 0.7)).toBe(true);
    expect(policy.formatArms.find((arm) => arm.arm === 'question')?.coldStart).toBe(true);
  });

  it('penalizes strategies that operators delete', () => {
    const questionTweet = tweetEntry({
      id: 'question-1',
      content: 'Should every startup raise now?',
      format: 'question',
      topic: 'Startups',
    });
    const hotTakeTweet = tweetEntry({
      id: 'hot-1',
      content: 'Distribution beats product longer than founders admit.',
      format: 'hot_take',
      topic: 'Startups',
    });
    const feedback: FeedbackEntry[] = [{
      tweetId: 'question-1',
      tweetText: questionTweet.content,
      rating: 'down',
      generatedAt: '2026-04-02T00:00:00.000Z',
      intentSummary: 'Too generic',
      source: 'queue_delete',
      userProvidedReason: true,
    }];

    const policy = buildBanditPolicy({
      performanceHistory: [
        performanceEntry({
          tweetId: 'question-1',
          xTweetId: 'x-question-1',
          content: questionTweet.content,
          format: 'question',
          topic: 'Startups',
          likes: 30,
          retweets: 5,
          replies: 3,
        }),
        performanceEntry({
          tweetId: 'hot-1',
          xTweetId: 'x-hot-1',
          content: hotTakeTweet.content,
          format: 'hot_take',
          topic: 'Startups',
          likes: 30,
          retweets: 5,
          replies: 3,
        }),
      ],
      feedback,
      signals: [],
      allTweets: [questionTweet, hotTakeTweet],
      allowedFormats: ['question', 'hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });

    const questionArm = policy.formatArms.find((arm) => arm.arm === 'question');
    const hotTakeArm = policy.formatArms.find((arm) => arm.arm === 'hot_take');

    expect(questionArm?.failures).toBeGreaterThan(0);
    expect(questionArm?.meanReward).toBeLessThan(hotTakeArm?.meanReward || 1);
  });

  it('allocates explicit explore slots without repeating the same bet', () => {
    const plans = buildBanditSlotPlan({
      trainingSource: 'autopilot',
      totalPulls: 20,
      successThreshold: 15,
      globalPriorWeight: 0.35,
      localEvidenceWeight: 0.65,
      formatArms: [
        arm({ arm: 'hot_take', family: 'format', pulls: 12, successes: 10, failures: 2, meanReward: 0.83, explorationBonus: 0.4, ucbScore: 1.23, coldStart: false }),
        arm({ arm: 'question', family: 'format', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, explorationBonus: 1.2, ucbScore: 1.7, coldStart: true, localShare: 0 }),
        arm({ arm: 'analysis', family: 'format', pulls: 4, successes: 2, failures: 2, meanReward: 0.5, explorationBonus: 0.8, ucbScore: 1.3, coldStart: false }),
      ],
      topicArms: [
        arm({ arm: 'AI', family: 'topic', pulls: 10, successes: 8, failures: 2, meanReward: 0.8, explorationBonus: 0.4, ucbScore: 1.2, coldStart: false }),
        arm({ arm: 'Markets', family: 'topic', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, explorationBonus: 1.2, ucbScore: 1.7, coldStart: true, localShare: 0 }),
        arm({ arm: 'Startups', family: 'topic', pulls: 5, successes: 3, failures: 2, meanReward: 0.6, explorationBonus: 0.7, ucbScore: 1.3, coldStart: false }),
      ],
      lengthArms: [
        arm({ arm: 'medium', family: 'length', pulls: 10, successes: 8, failures: 2, meanReward: 0.8, explorationBonus: 0.4, ucbScore: 1.2, coldStart: false }),
        arm({ arm: 'long', family: 'length', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, explorationBonus: 1.2, ucbScore: 1.7, coldStart: true, localShare: 0 }),
        arm({ arm: 'short', family: 'length', pulls: 4, successes: 2, failures: 2, meanReward: 0.5, explorationBonus: 0.7, ucbScore: 1.2, coldStart: false }),
      ],
      hookArms: [
        arm({ arm: 'bold_claim', family: 'hook', pulls: 8, successes: 6, meanReward: 0.76 }),
        arm({ arm: 'question', family: 'hook', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, coldStart: true, localShare: 0 }),
      ],
      toneArms: [
        arm({ arm: 'analytical', family: 'tone', pulls: 8, successes: 6, meanReward: 0.74 }),
        arm({ arm: 'provocative', family: 'tone', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, coldStart: true, localShare: 0 }),
      ],
      specificityArms: [
        arm({ arm: 'concrete', family: 'specificity', pulls: 8, successes: 6, meanReward: 0.71 }),
        arm({ arm: 'data_driven', family: 'specificity', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, coldStart: true, localShare: 0 }),
      ],
      structureArms: [
        arm({ arm: 'argument', family: 'structure', pulls: 8, successes: 6, meanReward: 0.73 }),
        arm({ arm: 'stacked_lines', family: 'structure', pulls: 0, localPulls: 0, successes: 0, failures: 0, meanReward: 0.5, coldStart: true, localShare: 0 }),
      ],
      summary: [],
    }, {
      count: 6,
      explorationRate: 34,
      biasTopics: ['Markets'],
    });

    expect(plans).toHaveLength(6);
    expect(plans.some((plan) => plan.mode === 'explore')).toBe(true);
    expect(plans.some((plan) => plan.topic === 'Markets')).toBe(true);
    expect(new Set(plans.map((plan) => `${plan.format}::${plan.topic}::${plan.length}`)).size).toBe(plans.length);
  });
});
