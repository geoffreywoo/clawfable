import { describe, expect, it } from 'vitest';
import { buildFallbackLearningMetadata, buildPersonalizationMemory, summarizeEditDelta } from '@/lib/learning-loop';
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
  it('captures before/after lessons when edits replace low-status texture with technical anchors', () => {
    const summary = summarizeEditDelta(
      'AI infrastructure is working when the Slack channel gets quieter and every support queue has a clean workflow handoff.',
      'Inference ASIC deployment is real when HBM bandwidth, packaging yield, and rack power density survive thermal cycling.',
    );

    expect(summary.metadata.addedTechnicalCredibility).toBe(true);
    expect(summary.metadata.removedLowStatusTexture).toBe(true);
    expect(Number(summary.metadata.editedTechnicalCredibilityScore)).toBeGreaterThan(Number(summary.metadata.originalTechnicalCredibilityScore));
    expect(Number(summary.metadata.editedStatusTextureRisk)).toBeLessThan(Number(summary.metadata.originalStatusTextureRisk));
    expect(summary.preferenceHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('harder technical anchors'),
        expect.stringContaining('Slack/support/workflow texture'),
      ]),
    );
  });

  it('turns deletion language like lame or too Slack into concrete future memory', () => {
    const memory = buildPersonalizationMemory({
      feedback: [
        {
          tweetId: 'tweet-1',
          tweetText: 'The best AI teams know the product is working when the Slack channel gets quieter.',
          rating: 'down',
          generatedAt: '2026-06-07T12:00:00.000Z',
          reason: 'lame, too Slack, not elevated or technical enough, sounds like AI slop',
          intentSummary: 'lame, too Slack, not elevated or technical enough',
          source: 'queue_delete',
          userProvidedReason: true,
        },
      ],
      signals: [
        learningSignal({
          signalType: 'deleted_from_queue',
          reason: 'lame, too Slack, not elevated or technical enough, sounds like AI slop',
          metadata: {
            lowStatusTextureComplaint: true,
            technicalElevationRequested: true,
            aiSlopComplaint: true,
          },
        }),
      ],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'technical operator/investor',
        topics: ['AI', 'inference asics', 'fusion', 'rare earth minerals'],
        antiGoals: ['low-status SaaS-ops texture'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffreywoo: compressed technical frontier-tech voice.',
        summary: 'Geoffrey writes about industrial capacity and hard technical constraints.',
      },
    });

    expect(memory.operatorHiddenPreferences).toEqual(
      expect.arrayContaining([
        expect.stringContaining('generated, template-like'),
        expect.stringContaining('Slack/support/workflow texture'),
        expect.stringContaining('elevated technical depth'),
      ]),
    );
  });

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
      topic: 'AI agents',
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
        operatorAnchor: 0.22,
        anchorCopyRisk: -0.06,
        authorityProof: 0.08,
        conversationQuality: 0.12,
      },
    } as Pick<Tweet, 'rationale' | 'sourceLane' | 'scoreProvenance' | 'draftExperimentId' | 'featureTags' | 'thesis' | 'topic'>);

    expect(metadata).toMatchObject({
      generationFallback: true,
      fallbackKind: 'provider_template_fallback',
      fallbackMemoryAligned: true,
      fallbackMemoryAlignment: 0.18,
      fallbackOperatorAnchor: true,
      fallbackOperatorAnchorScore: 0.22,
      fallbackAnchorCopyRisk: 0.06,
      fallbackSourceLane: 'core_explore_fallback',
      fallbackTopic: 'AI agents',
      fallbackHook: 'observation',
      fallbackTone: 'analytical',
      fallbackSpecificity: 'concrete',
      fallbackStructure: 'list',
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

  it('learns operator-anchor fallback outcomes separately from generic fallback outcomes', () => {
    const personalization = buildPersonalizationMemory({
      feedback: [],
      signals: [
        learningSignal({
          id: 'posted-anchor-fallback',
          signalType: 'x_post_succeeded',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackMemoryAligned: true,
            fallbackOperatorAnchor: true,
            fallbackOperatorAnchorScore: 0.22,
            fallbackAnchorCopyRisk: 0,
            fallbackHook: 'bold_claim',
            fallbackTone: 'analytical',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
            fallbackThesis: 'ai agents trust comes from behavior evidence',
          },
        }),
        learningSignal({
          id: 'posted-generic-fallback',
          tweetId: 'tweet-2',
          signalType: 'x_post_succeeded',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackMemoryAligned: false,
            fallbackOperatorAnchor: false,
            fallbackThesis: 'ai agents trust comes from behavior evidence',
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
        expect.stringContaining('operator-anchor provider template fallback drafts can survive approval/posting'),
        expect.stringContaining('provider template fallback drafts survived approval/posting'),
      ]),
    );
    expect(personalization.operatorHiddenPreferences).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Shape: bold_claim/single_punch/tactical.'),
      ]),
    );
    expect(personalization.fallbackShapeOutcomes).toEqual([
      expect.objectContaining({
        fallbackKind: 'provider_template_fallback',
        shape: 'bold_claim/single_punch/tactical',
        approved: 0,
        posted: 1,
        edited: 0,
        rejected: 0,
        total: 1,
        netScore: 0.25,
        latestOutcome: 'posted',
        latestOutcomeAt: '2026-06-07T12:00:00.000Z',
      }),
    ]);
  });

  it('aggregates repeated operator-anchor fallback shape outcomes into compact counters', () => {
    const personalization = buildPersonalizationMemory({
      feedback: [],
      signals: [
        learningSignal({
          id: 'shape-posted-1',
          signalType: 'x_post_succeeded',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackTopic: 'AI agents',
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'shape-approved-1',
          signalType: 'approved_without_edit',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackTopic: 'AI agents',
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'shape-rejected-1',
          signalType: 'deleted_from_queue',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackTopic: 'Startups',
            fallbackHook: 'question',
            fallbackSpecificity: 'concrete',
            fallbackStructure: 'list',
          },
        }),
        learningSignal({
          id: 'shape-rejected-2',
          tweetId: 'tweet-2',
          signalType: 'x_post_rejected',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackTopic: 'Startups',
            fallbackHook: 'question',
            fallbackSpecificity: 'concrete',
            fallbackStructure: 'list',
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

    expect(personalization.fallbackShapeOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fallbackKind: 'provider_template_fallback',
          topic: 'AI agents',
          shape: 'bold_claim/single_punch/tactical',
          approved: 1,
          posted: 1,
          total: 2,
          netScore: 0.425,
          latestOutcome: 'approved',
        }),
        expect.objectContaining({
          fallbackKind: 'provider_template_fallback',
          topic: 'Startups',
          shape: 'question/list/concrete',
          rejected: 2,
          total: 2,
          netScore: -0.6,
          latestOutcome: 'rejected',
        }),
      ]),
    );
  });

  it('keeps operator-anchor fallback shape counters separated by topic', () => {
    const personalization = buildPersonalizationMemory({
      feedback: [],
      signals: [
        learningSignal({
          id: 'ai-shape-posted',
          signalType: 'x_post_succeeded',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackTopic: 'AI agents',
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'startup-shape-rejected',
          signalType: 'deleted_from_queue',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackTopic: 'Startups',
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
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

    expect(personalization.fallbackShapeOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: 'AI agents',
          shape: 'bold_claim/single_punch/tactical',
          posted: 1,
          rejected: 0,
        }),
        expect.objectContaining({
          topic: 'Startups',
          shape: 'bold_claim/single_punch/tactical',
          posted: 0,
          rejected: 1,
        }),
      ]),
    );
  });

  it('weights recent fallback shape outcomes more heavily than stale ones', () => {
    const personalization = buildPersonalizationMemory({
      feedback: [],
      signals: [
        learningSignal({
          id: 'old-shape-approved-1',
          signalType: 'approved_without_edit',
          createdAt: '2026-03-01T12:00:00.000Z',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'old-shape-approved-2',
          signalType: 'approved_without_edit',
          createdAt: '2026-03-02T12:00:00.000Z',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'old-shape-approved-3',
          signalType: 'approved_without_edit',
          createdAt: '2026-03-03T12:00:00.000Z',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'old-shape-approved-4',
          signalType: 'approved_without_edit',
          createdAt: '2026-03-04T12:00:00.000Z',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
          },
        }),
        learningSignal({
          id: 'recent-shape-rejected',
          signalType: 'deleted_from_queue',
          createdAt: '2026-06-07T12:00:00.000Z',
          metadata: {
            generationFallback: true,
            fallbackKind: 'provider_template_fallback',
            fallbackOperatorAnchor: true,
            fallbackHook: 'bold_claim',
            fallbackSpecificity: 'tactical',
            fallbackStructure: 'single_punch',
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

    expect(personalization.fallbackShapeOutcomes).toEqual([
      expect.objectContaining({
        fallbackKind: 'provider_template_fallback',
        shape: 'bold_claim/single_punch/tactical',
        approved: 4,
        rejected: 1,
        total: 5,
        netScore: expect.any(Number),
        latestOutcome: 'rejected',
        latestOutcomeAt: '2026-06-07T12:00:00.000Z',
        updatedAt: '2026-06-07T12:00:00.000Z',
      }),
    ]);
    expect(personalization.fallbackShapeOutcomes?.[0].netScore).toBeLessThan(0);
  });
});
