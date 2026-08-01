import { afterEach, describe, expect, it } from 'vitest';
import { FINAL_CRITIC_VERSION } from '@/lib/generation-judging';
import {
  assessGeoffreyQualityPolicy,
  GEOFFREY_QUALITY_POLICY_VERSION,
  getGeoffreyQualityPolicyActivation,
  type GeoffreyQualityCandidate,
} from '@/lib/quality-policy';
import type { AgentLearnings, PersonalizationMemory } from '@/lib/types';

const voiceProfile = {
  tone: 'technical operator/investor',
  topics: ['AI', 'startups', 'inference asics', 'fusion', 'robotics', 'manufacturing', 'space'],
  antiGoals: ['generic hype', 'AI slop', 'low-status SaaS-ops texture'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual, compressed startup-native voice.',
  summary: 'Geoffrey writes casual startup and frontier-tech takes from concrete constraints.',
};

const anchors = [
  { content: 'software is nepo + codex/claude\nhardware is where alpha is left', topic: 'AI', source: 'timeline' },
  { content: 'yes, threshold to beat is QQQ. mid market pe funds all seem like zombies.', topic: 'finance', source: 'timeline' },
  { content: 'x algo def way better. more useful content. more friends. yall cooking.', topic: 'product', source: 'timeline' },
  { content: 'padel is actually a good rich guy sport. easy enough to start, jus competitive enough to get obsessed.', topic: 'sports', source: 'timeline' },
];

const learnings = {
  operatorVoiceReference: {
    sampleCount: anchors.length,
    bestPerformers: anchors,
    pinnedExamples: [],
    startupRegisterExamples: anchors,
    styleFingerprint: {},
    corpusVersion: 'voice-corpus-v1-test',
  },
  voiceCorpus: {
    snapshotId: 'voice-corpus-v1-test',
    version: 1,
    active: true,
    targetAnchorCount: 40,
    minimumAnchorCount: 12,
    anchorCount: 12,
    topicSignalCount: 18,
    mechanicsOnlyCount: 8,
    negativeCount: 2,
    excludedCount: 7,
    knownGeneratedAnchorCount: 0,
    generatedAt: '2026-07-31T00:00:00.000Z',
  },
} as AgentLearnings;

const memory = {
  alwaysDoMoreOfThis: [],
  neverDoThisAgain: [],
  topicsWithMomentum: [],
  formatsUnderTested: [],
  operatorHiddenPreferences: [],
  editTransformations: [],
  identityConstraints: [],
  weeklyChanges: [],
  updatedAt: '2026-07-31T00:00:00.000Z',
} as PersonalizationMemory;

function candidate(overrides: Partial<GeoffreyQualityCandidate> = {}): GeoffreyQualityCandidate {
  return {
    content: 'openai bundling codex into every work surface makes a lot of vertical software look kinda cooked. model quality was never the whole product.',
    targetTopic: 'startups',
    sourceBrief: 'OpenAI expanded Codex across developer work surfaces.',
    sourceLane: 'manual_core_exploit',
    generationMode: 'balanced',
    confidenceScore: 0.86,
    slopScore: 0.05,
    judgeBreakdown: {
      overall: 0.84,
      voiceFit: 0.86,
      clarity: 0.84,
      novelty: 0.76,
      audienceFit: 0.82,
      policySafety: 0.96,
      nativeVoice: 0.86,
      casualStartupFit: 0.84,
      stiffnessRisk: 0.08,
      cringeRisk: 0.08,
      technicalCredibility: 0.6,
      manualAnchorReskinRisk: 0.06,
    },
    finalCriticProvider: 'openai',
    finalCriticModel: 'gpt-5.5',
    finalCriticVerdict: 'allow',
    finalCriticScores: {
      overall: 0.86,
      voiceFit: 0.88,
      clarity: 0.86,
      novelty: 0.78,
      audienceFit: 0.84,
      policySafety: 0.97,
      nativeVoice: 0.88,
      casualStartupFit: 0.86,
      stiffnessRisk: 0.07,
      cringeRisk: 0.07,
      technicalCredibility: 0.62,
      manualAnchorReskinRisk: 0.05,
    },
    finalCriticVersion: FINAL_CRITIC_VERSION,
    qualityPolicyVersion: GEOFFREY_QUALITY_POLICY_VERSION,
    voiceCorpusVersion: 'voice-corpus-v1-test',
    ...overrides,
  };
}

function assess(value: GeoffreyQualityCandidate) {
  return assessGeoffreyQualityPolicy(value, {
    voiceProfile,
    learnings,
    memory,
    stage: 'queue',
  });
}

describe('Geoffrey hard quality policy', () => {
  afterEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.GEOFFREY_AUTOPOST_QUALITY_POLICY_VERSION;
  });

  it('requires the exact policy version to activate production autoposting', () => {
    process.env.VERCEL_ENV = 'production';

    expect(getGeoffreyQualityPolicyActivation()).toMatchObject({
      activated: false,
      configuredVersion: null,
      currentVersion: GEOFFREY_QUALITY_POLICY_VERSION,
      requiresExplicitProductionActivation: true,
    });

    process.env.GEOFFREY_AUTOPOST_QUALITY_POLICY_VERSION = 'geoffwoo-quality-old';
    expect(getGeoffreyQualityPolicyActivation().activated).toBe(false);

    process.env.GEOFFREY_AUTOPOST_QUALITY_POLICY_VERSION = GEOFFREY_QUALITY_POLICY_VERSION;
    expect(getGeoffreyQualityPolicyActivation().activated).toBe(true);
  });

  it('allows a native source-backed startup take that clears every hard gate', () => {
    const result = assess(candidate());

    expect(result.eligible, result.issues.join('; ')).toBe(true);
    expect(result.scores.nativeVoice).toBeGreaterThanOrEqual(0.65);
    expect(result.scores.casualStartupFit).toBeGreaterThanOrEqual(0.58);
  });

  it('does not apply the technical credibility floor to a concrete sports take', () => {
    const result = assess(candidate({
      content: 'jake paul calling out nfl guys is way more interesting than another influencer fight. those guys actually have money and something to lose.',
      targetTopic: 'sports and competitive behavior',
      sourceBrief: 'A current sourced boxing challenge involving Jake Paul and NFL players.',
      sourceEvidenceTexts: ['Jake Paul challenged NFL players to a boxing match.'],
      judgeBreakdown: {
        ...candidate().judgeBreakdown!,
        nativeVoice: 0.86,
        casualStartupFit: 0.84,
        technicalCredibility: 0.08,
      },
      finalCriticScores: {
        ...candidate().finalCriticScores!,
        nativeVoice: 0.88,
        casualStartupFit: 0.86,
        technicalCredibility: 0.08,
      },
    }));

    expect(result.scores.technicalCredibility).toBeLessThan(0.45);
    expect(result.issues.some((issue) => issue.startsWith('technical credibility'))).toBe(false);
    expect(result.eligible, result.issues.join('; ')).toBe(true);
  });

  it('uses the documented numeric gates instead of a stricter coarse review verdict', () => {
    const result = assess(candidate({
      content: 'rhenium demand can rise and the supply stream barely cares because it comes from copper and molybdenum mining.',
      targetTopic: 'rhenium supply for rocket engines',
      sourceBrief: 'Rhenium is recovered mainly as a byproduct of copper and molybdenum mining and used in aerospace superalloys.',
      sourceEvidenceTexts: [
        'Rhenium is recovered mainly as a byproduct of copper and molybdenum mining and used in aerospace superalloys.',
      ],
      confidenceScore: 0.76,
      slopScore: 0.18,
      judgeBreakdown: {
        overall: 0.8,
        voiceFit: 0.78,
        clarity: 0.84,
        novelty: 0.82,
        audienceFit: 0.8,
        policySafety: 0.96,
        nativeVoice: 0.72,
        casualStartupFit: 0.59,
        stiffnessRisk: 0.05,
        cringeRisk: 0.27,
        technicalCredibility: 0.49,
        manualAnchorReskinRisk: 0.04,
      },
      finalCriticScores: {
        overall: 0.8,
        voiceFit: 0.78,
        clarity: 0.84,
        novelty: 0.82,
        audienceFit: 0.8,
        policySafety: 0.96,
        nativeVoice: 0.72,
        casualStartupFit: 0.59,
        stiffnessRisk: 0.05,
        cringeRisk: 0.27,
        technicalCredibility: 0.49,
        manualAnchorReskinRisk: 0.04,
      },
    }));

    expect(result.eligible, result.issues.join('; ')).toBe(true);
  });

  it('does not let explore mode bypass the confidence floor', () => {
    const result = assess(candidate({ generationMode: 'explore', confidenceScore: 0.61 }));

    expect(result.eligible).toBe(false);
    expect(result.issues).toContain('confidence 0.61 below 0.62');
  });

  it('blocks stale policy and corpus versions even with a high engagement prediction', () => {
    const result = assess(candidate({
      qualityPolicyVersion: 'old-policy',
      voiceCorpusVersion: 'old-corpus',
      predictedEngagementScore: 1,
    } as Partial<GeoffreyQualityCandidate>));

    expect(result.eligible).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'stale quality policy version',
      'stale voice corpus version',
    ]));
  });

  it('requires a model final critic and blocks copied network prose', () => {
    const noCritic = assess(candidate({
      finalCriticProvider: null,
      finalCriticModel: null,
      finalCriticVerdict: null,
      finalCriticScores: null,
    }));
    const source = 'Hybrid bonding surface roughness determines alignment yield across advanced chiplet packages.';
    const copied = assess(candidate({
      content: 'Hybrid bonding surface roughness determines alignment yield across advanced chiplet packages.',
      targetTopic: 'advanced packaging',
      sourceLane: 'trend_aligned_exploit',
      trendTopicId: 'network-hybrid-bonding',
      sourceEvidenceTexts: [source],
    }));

    expect(noCritic.eligible).toBe(false);
    expect(noCritic.issues).toEqual(expect.arrayContaining([
      'missing model final critic',
      'final critic missing',
    ]));
    expect(copied.eligible).toBe(false);
    expect(copied.scores.sourceCopy).toBeGreaterThanOrEqual(0.3);
    expect(copied.issues.some((issue) => issue.startsWith('source copy'))).toBe(true);
  });
});
