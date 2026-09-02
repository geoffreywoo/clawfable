import { describe, expect, it } from 'vitest';
import { buildBanditGlobalPrior, buildBanditPolicy, buildBanditSlotPlan, summarizeBanditExploitLessons } from '@/lib/bandit';
import type { FeedbackEntry, LearningSignal, LearningSignalType, Tweet, TweetPerformance } from '@/lib/types';

function arm(overrides: Partial<import('@/lib/bandit').BanditArmScore> & { arm: string; family: import('@/lib/bandit').BanditArmScore['family'] }): import('@/lib/bandit').BanditArmScore {
  return {
    arm: overrides.arm,
    family: overrides.family,
    pulls: overrides.pulls ?? 3,
    localPulls: overrides.localPulls ?? overrides.pulls ?? 3,
    outcomePulls: overrides.outcomePulls ?? overrides.localPulls ?? overrides.pulls ?? 3,
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

function signalEntry(overrides: Partial<LearningSignal> & { tweetId: string; signalType: LearningSignalType }): LearningSignal {
  return {
    id: overrides.id || crypto.randomUUID(),
    agentId: overrides.agentId || 'agent-1',
    tweetId: overrides.tweetId,
    xTweetId: overrides.xTweetId,
    signalType: overrides.signalType,
    surface: overrides.surface || 'queue',
    rewardDelta: overrides.rewardDelta ?? 0,
    createdAt: overrides.createdAt || new Date().toISOString(),
    metadata: overrides.metadata,
  };
}

/** One approved, cron-posted tweet plus its measured performance row: the supervised production path. */
function approvedPostedTweet(id: string, overrides: { format: string; topic: string; content: string; likes: number; engagementRate: number }) {
  const tweet = tweetEntry({
    id,
    content: overrides.content,
    format: overrides.format,
    topic: overrides.topic,
    status: 'posted',
    xTweetId: `x-${id}`,
  });
  const signals = [
    signalEntry({ tweetId: id, signalType: 'approved_without_edit', surface: 'queue' }),
    signalEntry({ tweetId: id, signalType: 'x_post_succeeded', surface: 'cron' }),
  ];
  const performance = performanceEntry({
    tweetId: id,
    xTweetId: `x-${id}`,
    content: overrides.content,
    format: overrides.format,
    topic: overrides.topic,
    likes: overrides.likes,
    retweets: Math.round(overrides.likes / 10),
    replies: Math.round(overrides.likes / 20),
    impressions: 1000,
    engagementRate: overrides.engagementRate,
    source: 'autopilot',
  });
  return { tweet, signals, performance };
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

  it('penalizes strategies that operators delete from the queue using the preserved feedback text', () => {
    // A queue rejection hard-deletes the Tweet record, so the deleted draft is
    // deliberately absent from allTweets and only the feedback entry's text
    // survives. Style arms come from that text; format/topic cannot.
    const hotTakeTweet = tweetEntry({
      id: 'hot-1',
      content: 'Distribution beats product longer than founders admit.',
      format: 'hot_take',
      topic: 'Startups',
    });
    const feedback: FeedbackEntry[] = [{
      tweetId: 'question-1',
      tweetText: 'Should every startup raise now?',
      rating: 'down',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Too generic',
      source: 'queue_delete',
      userProvidedReason: true,
    }];

    const policy = buildBanditPolicy({
      performanceHistory: [],
      feedback,
      signals: [],
      allTweets: [hotTakeTweet],
      allowedFormats: ['question', 'hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });

    const questionHook = policy.hookArms.find((arm) => arm.arm === 'question');
    const boldClaimHook = policy.hookArms.find((arm) => arm.arm === 'bold_claim');
    const questionLed = policy.structureArms.find((arm) => arm.arm === 'question_led');

    expect(questionHook?.failures).toBeGreaterThan(0);
    expect(questionHook?.localPulls).toBeCloseTo(1.2, 1);
    expect(questionHook?.meanReward).toBeLessThan(boldClaimHook?.meanReward || 1);
    expect(questionLed?.failures).toBeGreaterThan(0);
    // Without a Tweet record there is nothing to attribute a format or topic to.
    expect(policy.formatArms.every((arm) => arm.localPulls === 0)).toBe(true);
    expect(policy.topicArms.every((arm) => arm.localPulls === 0)).toBe(true);
  });

  it('reinforces strategies the operator endorses with thumbs-up feedback', () => {
    // The setup wizard saves first-batch preview votes without a tweetId; the
    // vote must still reach the style arms from the preserved text.
    const hotTakeTweet = tweetEntry({
      id: 'hot-up',
      content: 'Distribution beats product longer than founders admit.',
      format: 'hot_take',
      topic: 'Startups',
    });
    const feedback: FeedbackEntry[] = [{
      tweetText: 'Should every startup raise now?',
      rating: 'up',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Exactly my voice',
      source: 'preview_feedback',
      userProvidedReason: true,
    }];

    const policy = buildBanditPolicy({
      performanceHistory: [],
      feedback,
      signals: [],
      allTweets: [hotTakeTweet],
      allowedFormats: ['question', 'hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });

    const questionHook = policy.hookArms.find((arm) => arm.arm === 'question');
    const boldClaimHook = policy.hookArms.find((arm) => arm.arm === 'bold_claim');

    // The endorsed hook gains local evidence and outranks the unobserved one.
    expect(questionHook?.localPulls).toBeGreaterThan(0);
    expect(questionHook?.failures).toBe(0);
    expect(questionHook?.meanReward).toBeGreaterThan(boldClaimHook?.meanReward || 1);
    // Thumbs are operator taste, not measured outcomes.
    expect(questionHook?.outcomePulls).toBe(0);
  });

  it('observes first-batch preview thumbs-down that arrive without a tweetId', () => {
    const policy = buildBanditPolicy({
      performanceHistory: [],
      feedback: [{
        tweetText: 'Should every startup raise now?',
        rating: 'down',
        generatedAt: new Date().toISOString(),
        source: 'preview_feedback',
      }],
      signals: [],
      allTweets: [],
      allowedFormats: ['question', 'hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });

    const questionHook = policy.hookArms.find((arm) => arm.arm === 'question');
    expect(questionHook?.localPulls).toBeGreaterThan(0);
    expect(questionHook?.failures).toBeGreaterThan(0);
    expect(policy.totalPulls).toBe(1);
  });

  it('lets measured flops on approved posts register as failures and keeps strong lifts near the top', () => {
    const baselineRows = Array.from({ length: 6 }, (_, index) =>
      performanceEntry({
        tweetId: `base-${index}`,
        xTweetId: `x-base-${index}`,
        content: `substations and transformers determine when AI compute can come online ${index}.`,
        format: 'analysis',
        topic: 'Infra',
        likes: 40,
        retweets: 2,
        replies: 1,
        impressions: 1000,
        engagementRate: 13,
      })
    );
    const build = (likes: number, engagementRate: number) => {
      const posts = Array.from({ length: 3 }, (_, index) =>
        approvedPostedTweet(`hot-${index}`, {
          format: 'hot_take',
          topic: 'Markets',
          content: `Distribution beats product longer than founders admit ${index}.`,
          likes,
          engagementRate,
        })
      );
      return buildBanditPolicy({
        performanceHistory: [...baselineRows, ...posts.map((post) => post.performance)],
        feedback: [],
        signals: posts.flatMap((post) => post.signals),
        allTweets: posts.map((post) => post.tweet),
        allowedFormats: ['hot_take', 'analysis'],
        candidateTopics: ['Markets', 'Infra'],
        baseline: null,
      });
    };

    // Operator approved three hot takes, cron posted them, each landed at zero
    // against a ~40-like baseline. Approval + posting must not outvote that.
    const flopPolicy = build(0, 0);
    const flopArm = flopPolicy.formatArms.find((arm) => arm.arm === 'hot_take');
    expect(flopArm?.failures).toBeGreaterThan(0);
    expect(flopArm?.outcomePulls).toBeGreaterThanOrEqual(3);
    expect(flopArm?.meanReward).toBeLessThan(0.5);
    expect(summarizeBanditExploitLessons(flopPolicy).some((line) => line.includes('"hot_take"'))).toBe(false);

    // The same three posts at 10x baseline still discriminate upward.
    const winPolicy = build(400, 50);
    const winArm = winPolicy.formatArms.find((arm) => arm.arm === 'hot_take');
    expect(winArm?.failures).toBe(0);
    expect(winArm?.meanReward).toBeGreaterThan(0.65);
    expect(winArm?.meanReward).toBeGreaterThan(flopArm?.meanReward || 1);
    expect(summarizeBanditExploitLessons(winPolicy).some((line) => line.includes('"hot_take"') && line.includes('with outcome data'))).toBe(true);
  });

  it('observes a live deletion once when the episode already carries the signal, and once via feedback when the tweet is gone', () => {
    const content = 'Distribution beats product longer than founders admit.';
    const deleted = tweetEntry({
      id: 'live-1',
      content,
      format: 'hot_take',
      topic: 'Startups',
      status: 'deleted_from_x',
      xTweetId: 'x-live-1',
    });
    const signals = [
      signalEntry({ tweetId: 'live-1', signalType: 'approved_without_edit' }),
      signalEntry({ tweetId: 'live-1', signalType: 'x_post_succeeded', surface: 'cron' }),
      signalEntry({ tweetId: 'live-1', signalType: 'deleted_from_x', surface: 'cron' }),
    ];
    const feedback: FeedbackEntry[] = [{
      tweetId: 'live-1',
      tweetText: content,
      rating: 'down',
      generatedAt: new Date().toISOString(),
      source: 'queue_delete',
      userProvidedReason: false,
    }];
    const options = {
      performanceHistory: [],
      allowedFormats: ['hot_take', 'question'],
      candidateTopics: ['Startups'],
      baseline: null,
    };

    // Tweet record survives (status deleted_from_x): episode wins, feedback entry is not re-observed.
    const episodePolicy = buildBanditPolicy({ ...options, feedback, signals, allTweets: [deleted] });
    const episodeHook = episodePolicy.hookArms.find((arm) => arm.arm === 'bold_claim');
    expect(episodeHook?.localPulls).toBeCloseTo(0.9, 1);
    expect(episodeHook?.failures).toBeGreaterThan(0);
    expect(episodePolicy.formatArms.find((arm) => arm.arm === 'hot_take')?.failures).toBeGreaterThan(0);
    expect(episodePolicy.totalPulls).toBe(1);

    // Tweet record hard-deleted: only the feedback entry remains and it still trains the style arms.
    const feedbackPolicy = buildBanditPolicy({ ...options, feedback, signals, allTweets: [] });
    const feedbackHook = feedbackPolicy.hookArms.find((arm) => arm.arm === 'bold_claim');
    expect(feedbackHook?.localPulls).toBeCloseTo(1, 1);
    expect(feedbackHook?.failures).toBeGreaterThan(0);
    expect(feedbackPolicy.totalPulls).toBe(1);

    // Feedback whose tweet has an episode without a matching signal is a separate event and stays observed.
    const unrelatedPolicy = buildBanditPolicy({
      ...options,
      feedback,
      signals: [signalEntry({ tweetId: 'live-1', signalType: 'approved_without_edit' })],
      allTweets: [tweetEntry({ ...deleted, status: 'posted' })],
    });
    expect(unrelatedPolicy.totalPulls).toBe(2);
  });

  it('never fallback-observes a tweet whose outcome is already an episode', () => {
    const post = approvedPostedTweet('covered-1', {
      format: 'analysis',
      topic: 'Infra',
      content: 'substations and transformers determine when AI compute can come online.',
      likes: 30,
      engagementRate: 12,
    });
    const options = {
      feedback: [],
      allowedFormats: ['analysis', 'hot_take'],
      candidateTopics: ['Infra'],
      baseline: null,
    };

    const episodePolicy = buildBanditPolicy({
      ...options,
      performanceHistory: [post.performance],
      signals: post.signals,
      allTweets: [post.tweet],
    });
    const fallbackPolicy = buildBanditPolicy({
      ...options,
      performanceHistory: [post.performance],
      signals: [],
      allTweets: [],
    });

    const episodeArm = episodePolicy.formatArms.find((arm) => arm.arm === 'analysis');
    const fallbackArm = fallbackPolicy.formatArms.find((arm) => arm.arm === 'analysis');
    // Exactly one observation per family: the final-stage episode (weight 1.1),
    // never episode plus the performance row again.
    expect(episodeArm?.localPulls).toBeCloseTo(1.1, 1);
    expect(episodeArm?.outcomePulls).toBeCloseTo(1.1, 1);
    expect(fallbackArm?.localPulls).toBeCloseTo(1, 1);
    expect(episodePolicy.totalPulls).toBe(1);
    expect(fallbackPolicy.totalPulls).toBe(1);
  });

  it('counts evidence events for totalPulls, not per-family observations', () => {
    const post = approvedPostedTweet('event-1', {
      format: 'hot_take',
      topic: 'Startups',
      content: 'Distribution beats product longer than founders admit.',
      likes: 30,
      engagementRate: 12,
    });
    const policy = buildBanditPolicy({
      performanceHistory: [],
      feedback: [],
      signals: post.signals,
      allTweets: [post.tweet],
      allowedFormats: ['hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });
    expect(policy.hookArms.find((arm) => arm.arm === 'bold_claim')?.localPulls).toBeGreaterThan(0);
    expect(policy.totalPulls).toBe(1);
  });

  it('does not promote approvals-only arms as what-is-working outcome evidence', () => {
    const tweets = Array.from({ length: 4 }, (_, index) => tweetEntry({
      id: `approved-${index}`,
      content: `Distribution beats product longer than founders admit ${index}.`,
      format: 'analysis',
      topic: 'Startups',
    }));
    const policy = buildBanditPolicy({
      performanceHistory: [],
      feedback: [],
      signals: tweets.map((tweet) => signalEntry({ tweetId: tweet.id, signalType: 'approved_without_edit' })),
      allTweets: tweets,
      allowedFormats: ['analysis', 'hot_take'],
      candidateTopics: ['Startups'],
      baseline: null,
    });
    const analysis = policy.formatArms.find((arm) => arm.arm === 'analysis');
    // The approvals still count as local evidence for ordering...
    expect(analysis?.localPulls).toBeGreaterThanOrEqual(3);
    expect(analysis?.meanReward).toBeGreaterThan(0.55);
    expect(analysis?.outcomePulls).toBe(0);
    // ...but nothing has been measured on X, so there is no outcome lesson.
    expect(summarizeBanditExploitLessons(policy)).toEqual([]);
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
      formatArms: [arm({ arm: 'hot_take', meanReward: 0.72, localPulls: 5, outcomePulls: 5 })],
      hookArms: [arm({ arm: 'contrarian', family: 'hook', meanReward: 0.66, localPulls: 4, outcomePulls: 3.2 })],
      toneArms: [
        arm({ arm: 'direct', family: 'tone', meanReward: 0.4, localPulls: 8, outcomePulls: 8 }),
        arm({ arm: 'earnest', family: 'tone', meanReward: 0.74, localPulls: 6, outcomePulls: 0 }),
      ],
      structureArms: [arm({ arm: 'single_claim', family: 'structure', meanReward: 0.8, localPulls: 1, outcomePulls: 1 })],
    });

    expect(lessons.some((line) => line.includes('hot_take') && line.includes('5 recent posts with outcome data'))).toBe(true);
    expect(lessons.some((line) => line.includes('contrarian'))).toBe(true);
    // Below the reward floor and below the pull floor respectively.
    expect(lessons.some((line) => line.includes('"direct"'))).toBe(false);
    expect(lessons.some((line) => line.includes('single_claim'))).toBe(false);
    // Plenty of approvals/thumbs but nothing measured on X: not outcome evidence.
    expect(lessons.some((line) => line.includes('"earnest"'))).toBe(false);
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
