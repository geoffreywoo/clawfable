import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLearningSnapshot } from '@/lib/learning-snapshot';
import type { BanditPolicy, BanditArmScore } from '@/lib/bandit';
import type {
  LearningSignal,
  PersonalizationMemory,
  ProtocolSettings,
  Tweet,
  TweetPerformance,
} from '@/lib/types';

function arm(overrides: Partial<BanditArmScore> & { arm: string }): BanditArmScore {
  return {
    arm: overrides.arm,
    family: overrides.family ?? 'format',
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

const settings: ProtocolSettings = {
  enabled: false,
  postsPerDay: 3,
  activeHoursStart: 0,
  activeHoursEnd: 24,
  minQueueSize: 5,
  autoReply: false,
  maxRepliesPerRun: 3,
  replyIntervalMins: 60,
  lastPostedAt: null,
  lastRepliedAt: null,
  totalAutoPosted: 0,
  totalAutoReplied: 0,
  lengthMix: { short: 30, medium: 40, long: 30 },
  autonomyMode: 'balanced',
  explorationRate: 35,
  trendMixTarget: 35,
  trendTolerance: 'moderate',
  enabledFormats: ['hot_take', 'question'],
  qtRatio: 0,
  marketingEnabled: false,
  marketingMix: 0,
  marketingRole: 'product',
  soulEvolutionMode: 'off',
  lastEvolvedAt: null,
  proactiveReplies: false,
  proactiveLikes: false,
  autoFollow: false,
  agentShoutouts: false,
  peakHours: [],
  contentCalendar: {},
};

const memory: PersonalizationMemory = {
  alwaysDoMoreOfThis: ['Lead with specifics.'],
  neverDoThisAgain: ['too generic'],
  topicsWithMomentum: ['AI'],
  formatsUnderTested: ['question needs more data'],
  operatorHiddenPreferences: ['Specificity and numbers are often added before approval.'],
  identityConstraints: ['Never be cringe'],
  weeklyChanges: ['Approval rate improved this week.'],
  updatedAt: new Date().toISOString(),
};

const policy: BanditPolicy = {
  trainingSource: 'autopilot',
  totalPulls: 18,
  successThreshold: 10,
  globalPriorWeight: 0.34,
  localEvidenceWeight: 0.66,
  formatArms: [
    arm({ arm: 'hot_take', family: 'format', meanReward: 0.73, pulls: 8, ucbScore: 1.01 }),
    arm({ arm: 'question', family: 'format', meanReward: 0.58, pulls: 1, ucbScore: 1.22, coldStart: true }),
  ],
  topicArms: [
    arm({ arm: 'AI', family: 'topic', meanReward: 0.76, pulls: 7, ucbScore: 1.02 }),
    arm({ arm: 'startups', family: 'topic', meanReward: 0.57, pulls: 2, ucbScore: 1.16 }),
  ],
  lengthArms: [
    arm({ arm: 'short', family: 'length', meanReward: 0.62, pulls: 5, ucbScore: 0.97 }),
    arm({ arm: 'medium', family: 'length', meanReward: 0.66, pulls: 6, ucbScore: 0.98 }),
    arm({ arm: 'long', family: 'length', meanReward: 0.49, pulls: 2, failures: 2, ucbScore: 0.81 }),
  ],
  hookArms: [
    arm({ arm: 'bold_claim', family: 'hook', meanReward: 0.71, pulls: 6 }),
    arm({ arm: 'question', family: 'hook', meanReward: 0.57, pulls: 1, coldStart: true }),
  ],
  toneArms: [
    arm({ arm: 'analytical', family: 'tone', meanReward: 0.72, pulls: 6 }),
    arm({ arm: 'provocative', family: 'tone', meanReward: 0.52, pulls: 1, coldStart: true }),
  ],
  specificityArms: [
    arm({ arm: 'concrete', family: 'specificity', meanReward: 0.69, pulls: 6 }),
    arm({ arm: 'data_driven', family: 'specificity', meanReward: 0.61, pulls: 2 }),
  ],
  structureArms: [
    arm({ arm: 'argument', family: 'structure', meanReward: 0.68, pulls: 5 }),
    arm({ arm: 'single_punch', family: 'structure', meanReward: 0.56, pulls: 2 }),
  ],
  summary: ['Exploit format: hot_take (73% reward)', 'Explore format: question'],
};

function tweet(overrides: Partial<Tweet> & { id: string; createdAt: string; content: string }): Tweet {
  return {
    id: overrides.id,
    agentId: overrides.agentId ?? 'agent-1',
    content: overrides.content,
    originalContent: overrides.originalContent ?? overrides.content,
    type: overrides.type ?? 'original',
    status: overrides.status ?? 'queued',
    format: overrides.format ?? 'hot_take',
    topic: overrides.topic ?? 'AI',
    xTweetId: overrides.xTweetId ?? null,
    quoteTweetId: overrides.quoteTweetId ?? null,
    quoteTweetAuthor: overrides.quoteTweetAuthor ?? null,
    scheduledAt: overrides.scheduledAt ?? null,
    deletionReason: overrides.deletionReason ?? null,
    editCount: overrides.editCount ?? 0,
    lastEditedAt: overrides.lastEditedAt ?? null,
    approvedAt: overrides.approvedAt ?? null,
    postedAt: overrides.postedAt ?? null,
    rationale: overrides.rationale ?? null,
    generationMode: overrides.generationMode ?? 'balanced',
    candidateScore: overrides.candidateScore ?? 78,
    confidenceScore: overrides.confidenceScore ?? 0.72,
    voiceScore: overrides.voiceScore ?? 0.71,
    noveltyScore: overrides.noveltyScore ?? 0.66,
    predictedEngagementScore: overrides.predictedEngagementScore ?? 0.69,
    freshnessScore: overrides.freshnessScore ?? 0.68,
    repetitionRiskScore: overrides.repetitionRiskScore ?? 0.18,
    policyRiskScore: overrides.policyRiskScore ?? 0.09,
    hookType: overrides.hookType ?? 'bold_claim',
    toneType: overrides.toneType ?? 'analytical',
    specificityType: overrides.specificityType ?? 'concrete',
    structureType: overrides.structureType ?? 'argument',
    thesis: overrides.thesis ?? 'AI adoption is speeding up.',
    coverageCluster: overrides.coverageCluster ?? 'ai-argument',
    featureTags: overrides.featureTags ?? null,
    judgeScore: overrides.judgeScore ?? 0.74,
    judgeBreakdown: overrides.judgeBreakdown ?? null,
    judgeNotes: overrides.judgeNotes ?? null,
    mutationRound: overrides.mutationRound ?? null,
    rewardPrediction: overrides.rewardPrediction ?? 0.74,
    globalPriorWeight: overrides.globalPriorWeight ?? 0.32,
    localPriorWeight: overrides.localPriorWeight ?? 0.68,
    scoreProvenance: overrides.scoreProvenance ?? null,
    rewardBreakdown: overrides.rewardBreakdown ?? null,
    quarantineReason: overrides.quarantineReason ?? null,
    quarantinedAt: overrides.quarantinedAt ?? null,
    createdAt: overrides.createdAt,
  };
}

function signal(overrides: Partial<LearningSignal> & { id: string; signalType: LearningSignal['signalType']; createdAt: string }): LearningSignal {
  return {
    id: overrides.id,
    agentId: overrides.agentId ?? 'agent-1',
    tweetId: overrides.tweetId,
    xTweetId: overrides.xTweetId,
    signalType: overrides.signalType,
    surface: overrides.surface ?? 'queue',
    rewardDelta: overrides.rewardDelta ?? 0.2,
    createdAt: overrides.createdAt,
    reason: overrides.reason,
    inferred: overrides.inferred,
    metadata: overrides.metadata,
  };
}

function performance(overrides: Partial<TweetPerformance> & { tweetId: string; xTweetId: string; postedAt: string; checkedAt: string; content: string }): TweetPerformance {
  return {
    tweetId: overrides.tweetId,
    xTweetId: overrides.xTweetId,
    content: overrides.content,
    format: overrides.format ?? 'hot_take',
    topic: overrides.topic ?? 'AI',
    hook: overrides.hook ?? 'bold_claim',
    tone: overrides.tone ?? 'analytical',
    specificity: overrides.specificity ?? 'concrete',
    structure: overrides.structure ?? 'argument',
    thesis: overrides.thesis ?? 'AI adoption is speeding up.',
    postedAt: overrides.postedAt,
    checkedAt: overrides.checkedAt,
    likes: overrides.likes ?? 12,
    retweets: overrides.retweets ?? 2,
    replies: overrides.replies ?? 1,
    impressions: overrides.impressions ?? 400,
    engagementRate: overrides.engagementRate ?? 0.04,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source ?? 'autopilot',
  };
}

describe('buildLearningSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('translates avoid items into explicit lessons and impacts', () => {
    const snapshot = buildLearningSnapshot({
      settings,
      learnings: null,
      memory,
      banditPolicy: policy,
      signals: [],
      feedback: [
        {
          tweetId: 'tweet-1',
          tweetText: 'Generic take',
          rating: 'down',
          generatedAt: new Date().toISOString(),
          reason: 'too generic',
          userProvidedReason: true,
        },
      ],
      allTweets: [],
      performanceHistory: [],
      baseline: { avgLikes: 10, avgRetweets: 2 },
    });

    const avoidBucket = snapshot.beliefState.find((bucket) => bucket.id === 'never');
    expect(avoidBucket?.howToRead).toContain('negative ranking pressure');
    expect(avoidBucket?.items[0].label).toBe('too generic');
    expect(avoidBucket?.items[0].lesson).toContain('Specificity is winning over abstraction');
    expect(avoidBucket?.items[0].impact).toContain('downranked');
  });

  it('describes experiment lanes as beliefs and hypotheses', () => {
    const snapshot = buildLearningSnapshot({
      settings,
      learnings: null,
      memory,
      banditPolicy: policy,
      signals: [],
      feedback: [],
      allTweets: [],
      performanceHistory: [],
      baseline: { avgLikes: 10, avgRetweets: 2 },
    });

    const formatLane = snapshot.experiments.lanes.find((lane) => lane.id === 'formats');
    expect(formatLane?.belief).toContain('hot take');
    expect(formatLane?.hypothesis).toContain('question');
    expect(formatLane?.nextCheck).toContain('more evidence');
  });

  it('builds an improving scoreboard from weekly approval and performance gains', () => {
    const allTweets = [
      tweet({
        id: 'tweet-prev-good',
        content: 'Last week solid AI take',
        createdAt: '2026-04-07T10:00:00.000Z',
        approvedAt: '2026-04-07T12:00:00.000Z',
        postedAt: '2026-04-07T12:10:00.000Z',
        status: 'posted',
        rewardPrediction: 0.46,
        confidenceScore: 0.49,
      }),
      tweet({
        id: 'tweet-prev-bad',
        content: 'Last week vague AI take',
        createdAt: '2026-04-08T10:00:00.000Z',
        status: 'draft',
        rewardPrediction: 0.41,
        confidenceScore: 0.43,
      }),
      tweet({
        id: 'tweet-current-1',
        content: 'This week sharp AI take with specifics',
        createdAt: '2026-04-15T08:00:00.000Z',
        approvedAt: '2026-04-15T08:12:00.000Z',
        postedAt: '2026-04-15T08:20:00.000Z',
        status: 'posted',
        rewardPrediction: 0.79,
        confidenceScore: 0.81,
      }),
      tweet({
        id: 'tweet-current-2',
        content: 'This week second AI take with data',
        createdAt: '2026-04-16T11:00:00.000Z',
        approvedAt: '2026-04-16T11:18:00.000Z',
        postedAt: '2026-04-16T11:22:00.000Z',
        status: 'posted',
        rewardPrediction: 0.76,
        confidenceScore: 0.78,
      }),
      tweet({
        id: 'tweet-current-3',
        content: 'This week queued AI draft',
        createdAt: '2026-04-17T09:00:00.000Z',
        approvedAt: '2026-04-17T09:14:00.000Z',
        status: 'queued',
        rewardPrediction: 0.74,
        confidenceScore: 0.77,
      }),
    ];

    const signals = [
      signal({
        id: 'signal-prev-approve',
        tweetId: 'tweet-prev-good',
        signalType: 'approved_without_edit',
        createdAt: '2026-04-07T12:00:00.000Z',
        rewardDelta: 0.7,
        metadata: { timeToApprovalMins: 120 },
      }),
      signal({
        id: 'signal-prev-delete',
        tweetId: 'tweet-prev-bad',
        signalType: 'deleted_from_queue',
        createdAt: '2026-04-08T11:00:00.000Z',
        rewardDelta: -0.8,
      }),
      signal({
        id: 'signal-current-approve-1',
        tweetId: 'tweet-current-1',
        signalType: 'approved_without_edit',
        createdAt: '2026-04-15T08:12:00.000Z',
        rewardDelta: 0.82,
        metadata: { timeToApprovalMins: 12 },
      }),
      signal({
        id: 'signal-current-post-1',
        tweetId: 'tweet-current-1',
        signalType: 'x_post_succeeded',
        createdAt: '2026-04-15T08:20:00.000Z',
        rewardDelta: 0.32,
        surface: 'cron',
      }),
      signal({
        id: 'signal-current-edit',
        tweetId: 'tweet-current-2',
        signalType: 'edited_before_post',
        createdAt: '2026-04-16T11:18:00.000Z',
        rewardDelta: 0.28,
        metadata: { timeToApprovalMins: 18, changedFeatureCount: 1 },
      }),
      signal({
        id: 'signal-current-post-2',
        tweetId: 'tweet-current-2',
        signalType: 'x_post_succeeded',
        createdAt: '2026-04-16T11:22:00.000Z',
        rewardDelta: 0.32,
        surface: 'cron',
      }),
      signal({
        id: 'signal-current-approve-3',
        tweetId: 'tweet-current-3',
        signalType: 'approved_without_edit',
        createdAt: '2026-04-17T09:14:00.000Z',
        rewardDelta: 0.84,
        metadata: { timeToApprovalMins: 14 },
      }),
    ];

    const performanceHistory = [
      performance({
        tweetId: 'tweet-prev-good',
        xTweetId: 'x-prev',
        content: 'Last week solid AI take',
        postedAt: '2026-04-07T12:10:00.000Z',
        checkedAt: '2026-04-09T12:00:00.000Z',
        likes: 8,
        retweets: 1,
        replies: 0,
      }),
      performance({
        tweetId: 'tweet-current-1',
        xTweetId: 'x-current-1',
        content: 'This week sharp AI take with specifics',
        postedAt: '2026-04-15T08:20:00.000Z',
        checkedAt: '2026-04-17T08:00:00.000Z',
        likes: 34,
        retweets: 5,
        replies: 2,
      }),
      performance({
        tweetId: 'tweet-current-2',
        xTweetId: 'x-current-2',
        content: 'This week second AI take with data',
        postedAt: '2026-04-16T11:22:00.000Z',
        checkedAt: '2026-04-18T10:00:00.000Z',
        likes: 29,
        retweets: 4,
        replies: 2,
      }),
    ];

    const snapshot = buildLearningSnapshot({
      settings,
      learnings: null,
      memory,
      banditPolicy: policy,
      signals,
      feedback: [],
      allTweets,
      performanceHistory,
      baseline: { avgLikes: 10, avgRetweets: 2 },
    });

    const currentWeek = snapshot.weeklySeries[snapshot.weeklySeries.length - 1];
    const previousWeek = snapshot.weeklySeries[snapshot.weeklySeries.length - 2];

    expect(snapshot.scoreboard.state).toBe('improving');
    expect(snapshot.scoreboard.headline).toBe('The system is improving');
    expect(currentWeek.approvalRate).toBeGreaterThan(previousWeek.approvalRate);
    expect(currentWeek.medianTimeToApproval).toBe(14);
    expect(currentWeek.engagementLift).toBeGreaterThan(previousWeek.engagementLift);
    expect(currentWeek.deleteFromX).toBe(0);
    expect(snapshot.topImprovements.some((item) => item.id === 'approval-rate')).toBe(true);
  });

  it('marks the system as regressing when live deletes spike', () => {
    const allTweets = [
      tweet({
        id: 'tweet-prev',
        content: 'Previous clean post',
        createdAt: '2026-04-08T09:00:00.000Z',
        approvedAt: '2026-04-08T09:15:00.000Z',
        postedAt: '2026-04-08T09:20:00.000Z',
        status: 'posted',
        rewardPrediction: 0.76,
        confidenceScore: 0.78,
      }),
      tweet({
        id: 'tweet-current',
        content: 'Current week bad live post',
        createdAt: '2026-04-16T10:00:00.000Z',
        approvedAt: '2026-04-16T10:20:00.000Z',
        postedAt: '2026-04-16T10:30:00.000Z',
        status: 'deleted_from_x',
        rewardPrediction: 0.82,
        confidenceScore: 0.8,
      }),
    ];

    const signals = [
      signal({
        id: 'signal-prev-approve',
        tweetId: 'tweet-prev',
        signalType: 'approved_without_edit',
        createdAt: '2026-04-08T09:15:00.000Z',
        rewardDelta: 0.8,
        metadata: { timeToApprovalMins: 15 },
      }),
      signal({
        id: 'signal-prev-post',
        tweetId: 'tweet-prev',
        signalType: 'x_post_succeeded',
        createdAt: '2026-04-08T09:20:00.000Z',
        rewardDelta: 0.32,
        surface: 'cron',
      }),
      signal({
        id: 'signal-current-post',
        tweetId: 'tweet-current',
        signalType: 'x_post_succeeded',
        createdAt: '2026-04-16T10:30:00.000Z',
        rewardDelta: 0.32,
        surface: 'cron',
      }),
      signal({
        id: 'signal-current-delete',
        tweetId: 'tweet-current',
        signalType: 'deleted_from_x',
        createdAt: '2026-04-17T14:00:00.000Z',
        rewardDelta: -0.96,
      }),
    ];

    const snapshot = buildLearningSnapshot({
      settings,
      learnings: null,
      memory,
      banditPolicy: policy,
      signals,
      feedback: [],
      allTweets,
      performanceHistory: [],
      baseline: { avgLikes: 10, avgRetweets: 2 },
    });

    const currentWeek = snapshot.weeklySeries[snapshot.weeklySeries.length - 1];

    expect(snapshot.scoreboard.state).toBe('regressing');
    expect(snapshot.scoreboard.headline).toBe('The system is regressing');
    expect(currentWeek.deleteFromX).toBe(1);
    expect(snapshot.topRegressions.some((item) => item.id === 'delete-rate')).toBe(true);
  });

  it('includes planner previews for lane mix, trends, and manual example curation', () => {
    const snapshot = buildLearningSnapshot({
      settings,
      learnings: {
        agentId: 'agent-1',
        updatedAt: new Date().toISOString(),
        totalTracked: 24,
        avgLikes: 18,
        avgRetweets: 3,
        bestPerformers: [],
        worstPerformers: [],
        formatRankings: [],
        topicRankings: [],
        insights: [],
        manualTopicProfile: [
          {
            topic: 'ai',
            angle: 'AI workflow leverage is outperforming raw model discourse',
            weight: 14,
            sampleCount: 5,
            avgEngagement: 91,
            topTweets: [],
          },
        ],
        operatorVoiceReference: {
          sampleCount: 5,
          bestPerformers: [
            performance({
              tweetId: '',
              xTweetId: 'manual-1',
              content: 'AI workflow leverage is the real wedge.',
              postedAt: '2026-04-14T10:00:00.000Z',
              checkedAt: '2026-04-15T10:00:00.000Z',
              likes: 110,
              source: 'timeline',
            }),
          ],
          styleFingerprint: {
            avgLength: 180,
            shortPct: 60,
            mediumPct: 40,
            longPct: 0,
            questionRatio: 10,
            usesLineBreaks: true,
            usesEmojis: false,
            usesNumbers: true,
            topHooks: ['bold_claim'],
            topTones: ['analytical'],
            antiPatterns: [],
            updatedAt: new Date().toISOString(),
          },
          pinnedExamples: [
            performance({
              tweetId: '',
              xTweetId: 'manual-pinned',
              content: 'Pinned manual winner about AI workflow leverage.',
              postedAt: '2026-04-13T10:00:00.000Z',
              checkedAt: '2026-04-14T10:00:00.000Z',
              likes: 140,
              source: 'timeline',
            }),
          ],
          blockedXTweetIds: ['manual-blocked'],
        },
        sourceLanePerformance: [
          { lane: 'manual_core_exploit', posts: 3, avgEngagement: 88, wins: 2 },
          { lane: 'trend_aligned_exploit', posts: 1, avgEngagement: 64, wins: 1 },
        ],
      },
      memory,
      banditPolicy: policy,
      signals: [],
      feedback: [],
      allTweets: [],
      performanceHistory: [],
      baseline: { avgLikes: 10, avgRetweets: 2 },
      manualExampleCuration: {
        pinnedXTweetIds: ['manual-pinned'],
        blockedXTweetIds: ['manual-blocked'],
        updatedAt: new Date().toISOString(),
      },
      sourcePlan: {
        slots: [],
        laneCounts: {
          manual_core_exploit: 2,
          trend_aligned_exploit: 1,
          trend_adjacent_explore: 0,
          core_explore_fallback: 1,
        },
        acceptedTrends: [
          {
            id: 42,
            headline: 'AI workflow agents are accelerating',
            source: '@alice',
            relevanceScore: 96,
            category: 'AI',
            timestamp: new Date().toISOString(),
            tweetCount: 8,
            topTweet: { id: 't1', text: 'AI workflow agents are accelerating', likes: 240, author: 'alice' },
            fitScores: { freshness: 0.9, velocity: 0.9, soul: 0.8, manual: 0.8, total: 0.86 },
            sourceLane: 'trend_aligned_exploit',
            plannerReason: 'Strong fit.',
          },
        ],
        rejectedTrends: [
          {
            id: 9,
            headline: 'Celebrity gossip spike',
            source: '@bob',
            relevanceScore: 60,
            category: 'culture',
            timestamp: new Date().toISOString(),
            tweetCount: 4,
            topTweet: { id: 't2', text: 'Celebrity gossip spike', likes: 30, author: 'bob' },
            fitScores: { freshness: 0.6, velocity: 0.3, soul: 0, manual: 0, total: 0.25 },
            sourceLane: 'reject',
            plannerReason: 'Off-brand.',
          },
        ],
      },
    });

    expect(snapshot.planner.trendMixTarget).toBe(35);
    expect(snapshot.planner.trendTolerance).toBe('moderate');
    expect(snapshot.planner.nextBatchMix.find((lane) => lane.lane === 'manual_core_exploit')?.plannedSlots).toBe(2);
    expect(snapshot.planner.acceptedTrends[0]?.id).toBe('42');
    expect(snapshot.planner.rejectedTrends[0]?.id).toBe('9');
    expect(snapshot.planner.manualExamples.pinnedCount).toBe(1);
    expect(snapshot.planner.manualExamples.blockedCount).toBe(1);
    expect(snapshot.planner.manualExamples.topicClusters[0]?.topic).toBe('ai');
    expect(snapshot.planner.manualExamples.examples.some((example) => example.xTweetId === 'manual-pinned' && example.pinned)).toBe(true);
  });
});
