import { describe, expect, it } from 'vitest';
import { assessAccountTaste } from '@/lib/account-taste';
import { FINAL_CRITIC_VERSION } from '@/lib/generation-judging';
import { assessGeoffreyQualityPolicy, GEOFFREY_QUALITY_POLICY_VERSION } from '@/lib/quality-policy';
import {
  GEOFFREY_KNOWN_BAD_EVAL,
  GEOFFREY_NATIVE_EVAL,
  GEOFFREY_NEAR_MISS_EVAL,
} from './fixtures/geoffrey-quality-eval';

const voiceProfile = {
  tone: 'technical operator/investor',
  topics: ['AI', 'startups', 'inference asics', 'fusion', 'fission', 'rare earth minerals', 'robotics', 'manufacturing', 'space'],
  antiGoals: ['generic hype', 'AI slop', 'low-status SaaS-ops texture'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual, compressed startup-native voice.',
  summary: 'Geoffrey writes casual startup and frontier-tech takes from concrete constraints.',
};

const anchors = GEOFFREY_NATIVE_EVAL.slice(0, 6).map((content, index) => ({
  content,
  topic: index < 3 ? 'startups' : 'frontier tech',
  source: 'timeline',
}));
const learnings = {
  operatorVoiceReference: {
    sampleCount: anchors.length,
    bestPerformers: anchors,
    pinnedExamples: [],
    startupRegisterExamples: anchors,
    styleFingerprint: {},
    corpusVersion: 'voice-corpus-v1-eval',
  },
  voiceCorpus: {
    snapshotId: 'voice-corpus-v1-eval',
    version: 1,
    active: true,
    targetAnchorCount: 40,
    minimumAnchorCount: 12,
    anchorCount: 40,
    topicSignalCount: 50,
    mechanicsOnlyCount: 20,
    negativeCount: 8,
    excludedCount: 14,
    knownGeneratedAnchorCount: 0,
    generatedAt: '2026-07-31T00:00:00.000Z',
  },
} as any;
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
} as any;

function qualityAssessment(content: string) {
  return assessGeoffreyQualityPolicy({
    content,
    targetTopic: 'frontier tech startups',
    sourceBrief: content,
    sourceLane: 'manual_core_exploit',
    generationMode: 'balanced',
    confidenceScore: 0.99,
    slopScore: 0,
    finalCriticProvider: 'openai',
    finalCriticModel: 'gpt-5.5',
    finalCriticVerdict: 'allow',
    finalCriticScores: {
      overall: 0.95,
      voiceFit: 0.95,
      clarity: 0.95,
      novelty: 0.95,
      audienceFit: 0.95,
      policySafety: 0.99,
      nativeVoice: 0.95,
      casualStartupFit: 0.95,
      stiffnessRisk: 0,
      cringeRisk: 0,
      technicalCredibility: 0.95,
      manualAnchorReskinRisk: 0,
    },
    finalCriticVersion: FINAL_CRITIC_VERSION,
    qualityPolicyVersion: GEOFFREY_QUALITY_POLICY_VERSION,
    voiceCorpusVersion: 'voice-corpus-v1-eval',
  }, {
    voiceProfile,
    learnings,
    memory,
    stage: 'queue',
  });
}

describe('fixed Geoffrey voice evaluation set', () => {
  it('blocks 100% of known generated-style failures despite optimistic model scores', () => {
    const blocked = GEOFFREY_KNOWN_BAD_EVAL.filter((content) => !qualityAssessment(content).eligible);
    expect(blocked).toHaveLength(GEOFFREY_KNOWN_BAD_EVAL.length);
  });

  it('achieves at least 90% native-versus-bad pairwise accuracy', () => {
    const pairs = GEOFFREY_NATIVE_EVAL.map((native, index) => {
      const bad = GEOFFREY_KNOWN_BAD_EVAL[index];
      const nativeScore = assessAccountTaste(native, { voiceProfile, learnings }).nativeVoiceScore;
      const badScore = assessAccountTaste(bad, { voiceProfile, learnings }).nativeVoiceScore;
      return nativeScore > badScore;
    });
    const accuracy = pairs.filter(Boolean).length / pairs.length;

    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('rejects at least 95% of subtle near-misses', () => {
    const rejected = GEOFFREY_NEAR_MISS_EVAL.filter((content) => !qualityAssessment(content).eligible);
    const rejectionRate = rejected.length / GEOFFREY_NEAR_MISS_EVAL.length;

    expect(rejectionRate).toBeGreaterThanOrEqual(0.95);
  });
});
