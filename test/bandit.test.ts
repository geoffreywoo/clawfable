import { describe, expect, it } from 'vitest';
import { buildBanditGlobalPrior, buildBanditPolicy, buildBanditSlotPlan, summarizeBanditExploitLessons } from '@/lib/bandit';
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
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return {
    tweetId: overrides.tweetId || crypto.randomUUID(),
    xTweetId: overrides.xTweetId || crypto.randomUUID(),
    content: overrides.content || 'tweet',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'AI',
    postedAt: overrides.postedAt || recent,
    checkedAt: overrides.checkedAt || new Date().toISOString(),
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
    createdAt: overrides.createdAt || new Date().toISOString(),
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
    const hotTake = policy.formatArms.find((arm) => arm.arm === 'hot_take');
    const analysis = policy.formatArms.find((arm) => arm.arm === 'analysis');
    expect(hotTake?.meanReward).toBeGreaterThan(analysis?.meanReward || 0);
    expect(hotTake?.localPulls).toBeGreaterThan(analysis?.localPulls || 0);
    expect(hotTake?.source).toBe('local_evidence');
    expect(policy.formatArms.find((arm) => arm.arm === 'question')?.coldStart).toBe(true);
  });

  it('keeps manually posted winners in the local policy even with enough autopilot history', () => {
    const performanceHistory = Array.from({ length: 10 }, (_, index) =>
      performanceEntry({
        tweetId: `auto-${index}`,
        xTweetId: `x-auto-${index}`,
        content: `autopilot infra miss ${index}`,
        format: 'analysis',
        topic: 'Infra',
        likes: 4,
        retweets: 0,
        replies: 0,
        source: 'autopilot',
      })
    ).concat([
      performanceEntry({
        tweetId: 'manual-1',
        xTweetId: 'x-manual-1',
        content: 'Biohacking got interesting when it became instrumentation, not supplement theater.',
        format: 'hot_take',
        topic: 'Biohacking',
        likes: 70,
        retweets: 8,
        replies: 4,
        source: 'manual',
        tone: 'provocative',
      }),
    ]);

    const policy = buildBanditPolicy({
      performanceHistory,
      feedback: [],
      signals: [],
      allTweets: [],
      allowedFormats: ['analysis', 'hot_take'],
      candidateTopics: ['Infra', 'Biohacking'],
      baseline: null,
    });

    expect(policy.trainingSource).toBe('mixed');
    expect(policy.formatArms[0]?.arm).toBe('hot_take');
    expect(policy.topicArms[0]?.arm).toBe('Biohacking');
    expect(policy.toneArms.find((arm) => arm.arm === 'provocative')?.localPulls).toBeGreaterThan(0);
  });

  it('treats timeline winners as operator evidence and collapses repeated checkpoints', () => {
    const policy = buildBanditPolicy({
      performanceHistory: [
        performanceEntry({
          tweetId: 'auto-1',
          xTweetId: 'x-auto-1',
          content: 'autopilot infrastructure miss',
          format: 'analysis',
          topic: 'Infra',
          likes: 3,
          source: 'autopilot',
          checkedAt: '2026-07-01T00:15:00.000Z',
        }),
        performanceEntry({
          tweetId: 'auto-1',
          xTweetId: 'x-auto-1',
          content: 'autopilot infrastructure miss',
          format: 'analysis',
          topic: 'Infra',
          likes: 5,
          source: 'autopilot',
          checkedAt: '2026-07-01T02:00:00.000Z',
        }),
        performanceEntry({
          tweetId: '',
          xTweetId: 'x-timeline-1',
          content: 'Biohacking got interesting when it became instrumentation, not supplement theater.',
          format: 'hot_take',
          topic: 'Biohacking',
          likes: 90,
          retweets: 10,
          replies: 8,
          source: 'timeline',
          tone: 'provocative',
        }),
      ],
      feedback: [],
      signals: [],
      allTweets: [],
      allowedFormats: ['analysis', 'hot_take'],
      candidateTopics: ['Infra', 'Biohacking'],
      baseline: null,
    });

    expect(policy.trainingSource).toBe('mixed');
    expect(policy.evidence).toMatchObject({
      performanceRows: 3,
      uniquePerformancePosts: 2,
      collapsedSnapshots: 1,
      operatorWrittenPosts: 1,
      systemWrittenPosts: 1,
    });
    expect(policy.formatArms[0]?.arm).toBe('hot_take');
    expect(policy.summary[0]).toContain('2 unique posts');
  });

  it('discounts obsolete generated scaffolds without throwing away their outcome', () => {
    const policy = buildBanditPolicy({
      performanceHistory: [
        performanceEntry({
          tweetId: 'patterned',
          xTweetId: 'x-patterned',
          content: 'a founder told me the old process took 42 minutes. the new one takes 6.',
          format: 'story',
          likes: 100,
          source: 'autopilot',
        }),
        performanceEntry({
          tweetId: 'qualified',
          xTweetId: 'x-qualified',
          content: 'substations and transformers determine when AI compute can come online.',
          format: 'analysis',
          likes: 100,
          source: 'autopilot',
        }),
      ],
      feedback: [],
      signals: [],
      allTweets: [],
      allowedFormats: ['story', 'analysis'],
      candidateTopics: ['AI'],
      baseline: null,
    });

    expect(policy.evidence?.qualityDiscountedSystemPosts).toBe(1);
    expect(policy.formatArms.find((arm) => arm.arm === 'story')?.localPulls)
      .toBeLessThan(policy.formatArms.find((arm) => arm.arm === 'analysis')?.localPulls || 0);
    expect(policy.formatArms.find((arm) => arm.arm === 'story')?.localPulls).toBeGreaterThan(0);

    const failedPolicy = buildBanditPolicy({
      performanceHistory: [
        performanceEntry({
          tweetId: 'patterned-miss',
          xTweetId: 'x-patterned-miss',
          content: 'a founder told me the workflow changed everything.',
          format: 'story',
          likes: 0,
          retweets: 0,
          replies: 0,
        }),
        performanceEntry({
          tweetId: 'qualified-miss',
          xTweetId: 'x-qualified-miss',
          content: 'substations determine deployment.',
          format: 'analysis',
          likes: 0,
          retweets: 0,
          replies: 0,
        }),
      ],
      feedback: [],
      signals: [],
      allTweets: [],
      allowedFormats: ['story', 'analysis'],
      candidateTopics: ['AI'],
      baseline: { avgLikes: 20, avgRetweets: 2 },
    });
    // Symmetric evidence weighting: a pattern-flagged miss is discounted the
    // same way a pattern-flagged win is, so flagged styles can still be
    // relearned when they outperform instead of accumulating only failures.
    expect(failedPolicy.formatArms.find((arm) => arm.arm === 'story')?.localPulls)
      .toBeLessThan(failedPolicy.formatArms.find((arm) => arm.arm === 'analysis')?.localPulls || 0);
    expect(failedPolicy.formatArms.find((arm) => arm.arm === 'story')?.localPulls).toBeGreaterThan(0);
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

  it('reinforces strategies the operator endorses with thumbs-up feedback', () => {
    const questionTweet = tweetEntry({
      id: 'question-up',
      content: 'Should every startup raise now?',
      format: 'question',
      topic: 'Startups',
    });
    const hotTakeTweet = tweetEntry({
      id: 'hot-up',
      content: 'Distribution beats product longer than founders admit.',
      format: 'hot_take',
      topic: 'Startups',
    });
    const feedback: FeedbackEntry[] = [{
      tweetId: 'question-up',
      tweetText: questionTweet.content,
      rating: 'up',
      generatedAt: '2026-04-02T00:00:00.000Z',
      intentSummary: 'Exactly my voice',
      source: 'preview_feedback',
      userProvidedReason: true,
    }];

    const policy = buildBanditPolicy({
      performanceHistory: [],
      feedback,
      signals: [],
      allTweets: [questionTweet, hotTakeTweet],
      allowedFormats: ['question', 'hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });

    const questionArm = policy.formatArms.find((arm) => arm.arm === 'question');
    const hotTakeArm = policy.formatArms.find((arm) => arm.arm === 'hot_take');

    // The endorsed format gains local evidence and outranks the unobserved one.
    expect(questionArm?.localPulls).toBeGreaterThan(0);
    expect(questionArm?.meanReward).toBeGreaterThan(hotTakeArm?.meanReward || 1);
  });

  it('summarizes proven arms as what-is-working lessons and skips cold-start noise', () => {
    const arm = (overrides: Record<string, unknown>) => ({
      arm: 'hot_take',
      family: 'format',
      pulls: 6,
      localPulls: 6,
      globalPulls: 0,
      priorPulls: 2,
      successes: 5,
      failures: 1,
      meanReward: 0.7,
      globalMeanReward: 0.5,
      explorationBonus: 0.02,
      uncertainty: 0.05,
      alpha: 5,
      beta: 2,
      ucbScore: 0.72,
      thompsonScore: 0.72,
      localShare: 1,
      coldStart: false,
      ...overrides,
    }) as any;

    const lessons = summarizeBanditExploitLessons({
      formatArms: [arm({ arm: 'hot_take', meanReward: 0.72, localPulls: 5 })],
      hookArms: [arm({ arm: 'contrarian', family: 'hook', meanReward: 0.66, localPulls: 4 })],
      toneArms: [arm({ arm: 'direct', family: 'tone', meanReward: 0.4, localPulls: 8 })],
      structureArms: [arm({ arm: 'single_claim', family: 'structure', meanReward: 0.8, localPulls: 1 })],
    });

    expect(lessons.some((line) => line.includes('hot_take'))).toBe(true);
    expect(lessons.some((line) => line.includes('contrarian'))).toBe(true);
    // Below the reward floor and below the pull floor respectively.
    expect(lessons.some((line) => line.includes('"direct"'))).toBe(false);
    expect(lessons.some((line) => line.includes('single_claim'))).toBe(false);
    expect(summarizeBanditExploitLessons(null)).toEqual([]);
  });

  it('normalizes global-prior rewards against each accounts own baseline', () => {
    const row = (id: string, format: string, likes: number) => performanceEntry({
      tweetId: id,
      xTweetId: `x-${id}`,
      content: `post ${id} with some real content about startups and capital.`,
      format,
      likes,
      retweets: Math.round(likes / 10),
      replies: 2,
    });
    // Big account: ~100-like baseline; its 30-like hot_take posts are BELOW its normal.
    const bigAccount = [
      ...Array.from({ length: 6 }, (_, i) => row(`big-base-${i}`, 'analysis', 100)),
      ...Array.from({ length: 3 }, (_, i) => row(`big-flop-${i}`, 'hot_take', 30)),
    ];
    // Small account: ~5-like baseline; its 30-like question posts are breakouts.
    const smallAccount = [
      ...Array.from({ length: 6 }, (_, i) => row(`small-base-${i}`, 'analysis', 5)),
      ...Array.from({ length: 3 }, (_, i) => row(`small-hit-${i}`, 'question', 30)),
    ];

    const prior = buildBanditGlobalPrior({
      accountHistories: [bigAccount, smallAccount],
      sourceAccounts: 2,
    });
    const arm = (name: string) => prior.families.format.find((entry) => entry.arm === name);

    // Same raw 30 likes: a breakout on the small account must outscore a
    // below-baseline post on the big account.
    expect(arm('question')!.meanReward).toBeGreaterThan(arm('hot_take')!.meanReward);
    expect(prior.totalSamples).toBe(bigAccount.length + smallAccount.length);

    // Legacy flat input keeps the old constant-baseline behavior.
    const flat = buildBanditGlobalPrior({
      performanceHistory: [...bigAccount, ...smallAccount],
      sourceAccounts: 2,
    });
    const flatQuestion = flat.families.format.find((entry) => entry.arm === 'question');
    const flatHotTake = flat.families.format.find((entry) => entry.arm === 'hot_take');
    expect(Math.abs(flatQuestion!.meanReward - flatHotTake!.meanReward)).toBeLessThan(0.05);
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
