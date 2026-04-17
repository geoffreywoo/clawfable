import { describe, expect, it } from 'vitest';
import { buildLearningSnapshot } from '@/lib/learning-snapshot';
import type { BanditPolicy, BanditArmScore } from '@/lib/bandit';
import type { PersonalizationMemory, ProtocolSettings } from '@/lib/types';

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

describe('buildLearningSnapshot', () => {
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
});
