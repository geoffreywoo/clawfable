import { describe, expect, it } from 'vitest';
import { assessAccountTaste, type AccountTasteAssessment } from '@/lib/account-taste';
import {
  GEOFFREY_KNOWN_BAD_EVAL,
  GEOFFREY_NATIVE_EVAL,
  GEOFFREY_NEAR_MISS_EVAL,
} from './fixtures/geoffrey-quality-eval';

const voiceProfile = {
  tone: 'technical operator/investor',
  topics: ['AI', 'startups', 'investing', 'culture', 'health', 'sports', 'frontier technology'],
  antiGoals: ['generic hype', 'low-status SaaS-ops texture'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed, casual, native voice.',
  summary: 'Geoffrey writes as a founder and investor about companies, markets, technology, ambition, and performance.',
};

const anchors = GEOFFREY_NATIVE_EVAL.map((content) => ({
  content,
  topic: 'native evaluation anchor',
  source: 'timeline',
}));

const learnings = {
  operatorVoiceReference: {
    bestPerformers: anchors,
    startupRegisterExamples: anchors,
    pinnedExamples: [],
  },
} as any;

function assess(content: string): AccountTasteAssessment {
  return assessAccountTaste(content, { voiceProfile, learnings });
}

function hardGateRejects(assessment: AccountTasteAssessment): boolean {
  return assessment.action === 'block'
    || assessment.nativeVoiceScore < 0.65
    || assessment.casualStartupScore < 0.58
    || assessment.cringeRisk >= 0.32
    || assessment.stiffnessRisk >= 0.3
    || assessment.generatedPatternRisk >= 0.28
    || assessment.voiceDriftRisk >= 0.2;
}

function pairwiseTasteScore(assessment: AccountTasteAssessment): number {
  return (
    assessment.nativeVoiceScore
    + assessment.casualStartupScore
    + (1 - assessment.cringeRisk)
    + (1 - assessment.stiffnessRisk)
    + (1 - assessment.generatedPatternRisk)
    + (1 - assessment.voiceDriftRisk)
  ) / 6;
}

describe('Geoffrey fixed quality evaluation', () => {
  it('allows the native anchors and blocks every known bad generated example', () => {
    expect(GEOFFREY_NATIVE_EVAL.filter((content) => hardGateRejects(assess(content)))).toHaveLength(0);
    expect(GEOFFREY_KNOWN_BAD_EVAL.filter((content) => hardGateRejects(assess(content)))).toHaveLength(
      GEOFFREY_KNOWN_BAD_EVAL.length,
    );
  });

  it('prefers native anchors over known bad examples in at least 90% of fixed pairs', () => {
    const wins = GEOFFREY_NATIVE_EVAL.filter((content, index) => (
      pairwiseTasteScore(assess(content))
      > pairwiseTasteScore(assess(GEOFFREY_KNOWN_BAD_EVAL[index % GEOFFREY_KNOWN_BAD_EVAL.length]))
    )).length;

    expect(wins / GEOFFREY_NATIVE_EVAL.length).toBeGreaterThanOrEqual(0.9);
  });

  it('rejects at least 95% of subtle near-misses', () => {
    const rejected = GEOFFREY_NEAR_MISS_EVAL.filter((content) => hardGateRejects(assess(content))).length;

    expect(rejected / GEOFFREY_NEAR_MISS_EVAL.length).toBeGreaterThanOrEqual(0.95);
  });
});
