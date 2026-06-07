import { describe, expect, it } from 'vitest';
import { buildFallbackLearningMetadata, buildPersonalizationMemory } from '@/lib/learning-loop';
import type { LearningSignal, Tweet } from '@/lib/types';

function editSignal(metadata: LearningSignal['metadata']): LearningSignal {
  return {
    id: 'signal-edit-1',
    agentId: 'agent-1',
    tweetId: 'tweet-1',
    signalType: 'edited_before_queue',
    surface: 'queue',
    rewardDelta: 0.24,
    reason: 'Operator edited this draft before approving it.',
    createdAt: '2026-05-30T12:00:00.000Z',
    metadata,
  };
}

function learningSignal(overrides: Partial<LearningSignal>): LearningSignal {
  return {
    id: overrides.id || `signal-${overrides.signalType || 'approved_without_edit'}`,
    agentId: 'agent-1',
    tweetId: 'tweet-1',
    signalType: overrides.signalType || 'approved_without_edit',
    surface: overrides.surface || 'queue',
    rewardDelta: overrides.rewardDelta ?? 0.5,
    createdAt: overrides.createdAt || '2026-06-07T12:00:00.000Z',
    metadata: overrides.metadata,
    reason: overrides.reason,
    inferred: overrides.inferred,
    xTweetId: overrides.xTweetId,
  };
}

describe('buildPersonalizationMemory', () => {
  it('retains multiple edit preference hints from a single operator rewrite', () => {
    const memory = buildPersonalizationMemory({
      feedback: [],
      signals: [
        editSignal({
          preferenceHint: 'Operators add sharper specifics, evidence, or examples before approving.',
          preferenceHints: [
            'Operators add sharper specifics, evidence, or examples before approving.',
            'Line-break structure improves readability and approval odds.',
            'Promotional CTA language lowers trust unless it is fully earned.',
          ].join('\n'),
        }),
      ],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific and operator-led',
        summary: 'Sharp AI operator voice.',
      },
    });

    expect(memory.operatorHiddenPreferences).toContain('Operators add sharper specifics, evidence, or examples before approving.');
    expect(memory.operatorHiddenPreferences).toContain('Line-break structure improves readability and approval odds.');
    expect(memory.operatorHiddenPreferences).toContain('Promotional CTA language lowers trust unless it is fully earned.');
  });

  it('extracts auditable fallback metadata from deterministic fallback tweets', () => {
    const metadata = buildFallbackLearningMetadata({
      rationale: 'Memory-aligned template fallback: operator preferences favor specificity.',
      sourceLane: 'core_explore_fallback',
      draftExperimentId: 'exp-batch-fallback-1',
      featureTags: {
        hook: 'observation',
        tone: 'analytical',
        specificity: 'concrete',
        structure: 'list',
        thesis: 'ai agents trust comes from behavior evidence',
        riskFlags: [],
      },
      thesis: null,
      scoreProvenance: {
        localPrior: 0,
        globalPrior: 0,
        judge: 0,
        predictedReward: 0.08,
        noveltyCoverage: 0.05,
        riskPenalty: 0,
        memoryAlignment: 0.18,
        authorityProof: 0.08,
        conversationQuality: 0.12,
      },
    } as Pick<Tweet, 'rationale' | 'sourceLane' | 'scoreProvenance' | 'draftExperimentId' | 'featureTags' | 'thesis'>);

    expect(metadata).toMatchObject({
      generationFallback: true,
      fallbackKind: 'provider_template_fallback',
      fallbackMemoryAligned: true,
      fallbackMemoryAlignment: 0.18,
      fallbackSourceLane: 'core_explore_fallback',
      fallbackThesis: 'ai agents trust comes from behavior evidence',
    });
  });

  it('turns fallback approval and rejection outcomes into future memory preferences', () => {
    const personalization = buildPersonalizationMemory({
      feedback: [],
      signals: [
        learningSignal({
          id: 'posted-fallback',
          signalType: 'x_post_succeeded',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackMemoryAligned: true,
            fallbackThesis: 'ai agents trust comes from behavior evidence',
          },
        }),
        learningSignal({
          id: 'rejected-fallback',
          tweetId: 'tweet-2',
          signalType: 'deleted_from_queue',
          rewardDelta: -0.75,
          metadata: {
            generationFallback: true,
            fallbackKind: 'emergency_queue_fallback',
            fallbackMemoryAligned: false,
            fallbackThesis: 'startup motion without learning is weak progress',
          },
        }),
      ],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific and operator-led',
        summary: 'Sharp AI operator voice.',
      },
    });

    expect(personalization.operatorHiddenPreferences).toEqual(
      expect.arrayContaining([
        expect.stringContaining('memory-aligned provider template fallback drafts can survive approval/posting'),
        expect.stringContaining('emergency queue fallback drafts were rejected'),
      ]),
    );
  });
});
