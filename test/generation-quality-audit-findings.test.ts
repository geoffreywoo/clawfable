import { describe, expect, it } from 'vitest';
import { buildGenerationAuditFindings, buildGenerationQueueHandoffAudit, buildGenerationWriterOutcomeAudit } from '@/lib/generation-quality-audit';

function healthyInput() {
  return {
    identity: {
      status: 'verified',
      storedHandle: '@geoffwoo',
      storedXUserId: 'x-user-13',
      connected: true,
      credentialsPresent: true,
      verifiedHandle: '@geoffwoo',
      verifiedXUserId: 'x-user-13',
      verifiedAt: '2026-08-14T00:00:00.000Z',
      verificationAgeHours: 1,
      verificationSource: 'x_api_v2_me',
      handleMatchesVerification: true,
      xUserIdMatchesVerification: true,
      requiresReconciliation: false,
    },
    autopost: { enabled: true, minQueueSize: 5 },
    corpus: {
      schemaVersion: 2,
      expectedSchemaVersion: 2,
      active: true,
      anchorCount: 40,
      targetAnchorCount: 40,
      minimumAnchorCount: 12,
      corpusPurity: 1,
      knownGeneratedAnchorCount: 0,
      surfaceRiskAnchorCount: 0,
      surfaceRiskAnchors: [],
    },
    queue: {
      qualityEligibleCount: 5,
      items: Array.from({ length: 5 }, (_, index) => ({
        id: `tweet-${index}`,
        qualityEligible: true,
        scores: { qualityMargin: 0.9 },
        content: `draft ${index}`,
      })),
    },
    currentPolicyWindow: {
      qualityPolicyVersion: 'publishing-v2-hard-gates-94',
      runCount: 4,
      runsWithSelectedDrafts: 4,
      selectedDraftCount: 5,
      selectionYield: 1,
      persistedSelectedDraftCount: 5,
      unpersistedSelectedDraftCount: 0,
      queueHandoffRate: 1,
      unpersistedDrafts: [] as Array<{
        generationRunId: string;
        draftCandidateId: string;
        content: string;
      }>,
      stageThroughput: {
        ideasSelected: 5,
        draftsEligible: 5,
        draftsSelected: 5,
        criticSelectionRate: 1,
      },
    },
    generationV2: {
      sample: { terminalQueueDecisions: 40, ideas: 100, drafts: 100, maturePosts: 25 },
      quality: {
        factualIncidentCount: 0,
        historicalFactualIncidentCount: 0,
        currentPolicyFactualIncidentCount: 0,
        userDeleteRate: 0.1,
        semanticRepeatRate: 0.03,
        deleteReasons: {},
      },
      gates: {
        acceptanceSampleReady: true,
        deleteRatePassed: true,
        semanticRepeatPassed: true,
        performanceSampleReady: true,
        currentPolicyPerformanceSampleReady: true,
      },
      performance: {
        reachVsOperator: 0.9,
        likesVsOperator: 0.9,
        currentPolicyReachVsOperator: 0.9,
        currentPolicyLikesVsOperator: 0.9,
        operatorBaselineSource: 'audited_static',
      },
      compute: {
        costDataStatus: 'complete',
        modelCalls: 20,
        unknownTokenAttempts: 0,
        unknownCostCalls: 0,
        estimatedCostUsd: 2.5 as number | null,
      },
    },
    complaints: { total: 0, affectedPostRate: 0 },
    modelPricing: { activeComplete: true, missingModels: [] },
    sources: {
      editorialEligibleCount: 3,
      generationEligibleCount: 1,
      warmedNetworkTopicCount: 48,
      operatorTopicSignalEligibleCount: 2,
      operatorTopicSignalRejectionCounts: [],
    },
  };
}

describe('generation quality audit findings', () => {
  it('counts a selected draft as persisted even after its draft status advances to queued', () => {
    expect(buildGenerationQueueHandoffAudit([{
      generationRunId: 'run-queued',
      selectedDraftIds: ['draft-queued', 'draft-dropped'],
      rejectionCounts: { queue_recent_semantic_duplicate: 1, final_quality_margin: 4 },
      drafts: [{
        draftCandidateId: 'draft-queued',
        status: 'queued',
        content: 'persisted draft',
        tweetId: 'tweet-queued',
      }, {
        draftCandidateId: 'draft-dropped',
        status: 'selected',
        content: 'dropped draft',
        tweetId: null,
      }],
    } as any])).toMatchObject({
      queueHandoffRate: 0.5,
      rejectionReasonCounts: { queue_recent_semantic_duplicate: 1 },
      persistedSelectedDrafts: [expect.objectContaining({ draftCandidateId: 'draft-queued' })],
      unpersistedSelectedDrafts: [expect.objectContaining({ draftCandidateId: 'draft-dropped' })],
    });
  });

  it('attributes initial and rescue outcomes by writer and compares parent quality', () => {
    const outcome = buildGenerationWriterOutcomeAudit([{
      generationRunId: 'run-repair',
      selectedDraftIds: ['draft-rescue'],
      stageCounts: { postcriticRescueTargets: 1 },
      ideas: [{
        ideaId: 'idea-asic',
        topic: 'inference ASIC rack economics',
        creativeSeedId: 'inference-system-economics',
      }],
      drafts: [{
        draftCandidateId: 'draft-parent',
        ideaId: 'idea-asic',
        parentDraftId: null,
        mutationRound: 0,
        generationModelStack: 'publishing_v2_gpt_control',
        generationProvider: 'openai',
        generationModel: 'gpt-5.6',
        judgeScore: 0.82,
        judgeBreakdown: { qualityMargin: 0.83, nativeVoice: 0.76, cringeRisk: 0.2 },
        rejectionCodes: ['final_quality_margin'],
        content: 'strong core that needs one repair',
      }, {
        draftCandidateId: 'draft-rescue',
        ideaId: 'idea-asic',
        parentDraftId: 'draft-parent',
        mutationRound: 1,
        generationModelStack: 'publishing_v2_fable_control',
        generationProvider: 'anthropic',
        generationModel: 'claude-fable-5',
        judgeScore: 0.91,
        judgeBreakdown: { qualityMargin: 0.9, nativeVoice: 0.86, cringeRisk: 0.08 },
        rejectionCodes: [],
        content: 'repaired strong core',
      }],
    } as any]);

    expect(outcome.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'initial', modelStack: 'publishing_v2_gpt_control', model: 'openai:gpt-5.6', generatedCount: 1, selectedCount: 0 }),
      expect.objectContaining({ phase: 'rescue', modelStack: 'publishing_v2_fable_control', model: 'anthropic:claude-fable-5', generatedCount: 1, selectedCount: 1 }),
    ]));
    expect(outcome.rescue).toMatchObject({
      targetCount: 1,
      generatedCount: 1,
      selectedCount: 1,
      pairedComparisonCount: 1,
      averageQualityMarginDelta: 0.07,
    });
    expect(outcome.topicMix).toMatchObject({
      generatedCount: 1,
      finalCriticCount: 1,
      selectedCount: 0,
      deepTechnicalGeneratedCount: 1,
      deepTechnicalFinalCriticCount: 1,
      deepTechnicalGeneratedShare: 1,
      deepTechnicalFinalCriticShare: 1,
      domains: [expect.objectContaining({ domain: 'ai_compute', generatedCount: 1 })],
      ideaCount: 1,
      deepTechnicalIdeaCount: 1,
      deepTechnicalIdeaShare: 1,
      ideaDomains: [expect.objectContaining({ domain: 'ai_compute', ideaCount: 1 })],
    });
    expect(outcome.nearMisses[0]).toMatchObject({
      topic: 'inference ASIC rack economics',
      topicDomain: 'ai_compute',
      creativeSeedId: 'inference-system-economics',
      deepTechnical: true,
    });
  });

  it('separates unique idea mix from draft volume and detects a finished critic near-miss', () => {
    const outcome = buildGenerationWriterOutcomeAudit([{
      generationRunId: 'run-mix',
      selectedDraftIds: [],
      stageCounts: {},
      ideas: [{
        ideaId: 'idea-asic',
        topic: 'inference ASIC rack economics',
      }, {
        ideaId: 'idea-ipo',
        topic: 'Modal Databricks IPO timing',
      }],
      drafts: [{
        draftCandidateId: 'draft-asic-one',
        ideaId: 'idea-asic',
        content: 'an inference chip draft',
        mutationRound: 0,
        rejectionCodes: ['final_technical_credibility_below_floor'],
      }, {
        draftCandidateId: 'draft-asic-two',
        ideaId: 'idea-asic',
        content: 'another inference chip draft',
        mutationRound: 0,
        rejectionCodes: ['final_cringe_risk'],
      }, {
        draftCandidateId: 'draft-asic-three',
        ideaId: 'idea-asic',
        content: 'third inference chip draft',
        mutationRound: 0,
        rejectionCodes: ['final_native_voice_below_floor'],
      }, {
        draftCandidateId: 'draft-ipo',
        ideaId: 'idea-ipo',
        content: 'modal is on the public markets before databricks. i am serious.',
        mutationRound: 0,
        judgeScore: 0.91,
        judgeBreakdown: { qualityMargin: 0.8589, nativeVoice: 0.799, casualStartupFit: 0.723, cringeRisk: 0.255 },
        judgeNotes: 'The named timing pick is native; no substantive rewrite is needed.',
        rejectionCodes: ['final_quality_margin'],
      }],
    } as any]);

    expect(outcome.topicMix).toMatchObject({
      generatedCount: 4,
      ideaCount: 2,
      deepTechnicalIdeaCount: 1,
      deepTechnicalIdeaShare: 0.5,
      ideaDomains: expect.arrayContaining([
        expect.objectContaining({ domain: 'ai_compute', ideaCount: 1 }),
        expect.objectContaining({ domain: 'finance_investing', ideaCount: 1 }),
      ]),
    });
    expect(outcome.criticCalibration).toMatchObject({
      finishedNearMissCount: 1,
      examples: [expect.objectContaining({ draftCandidateId: 'draft-ipo', qualityMargin: 0.8589 })],
    });
  });

  it('returns no findings for a healthy current state and historical window', () => {
    expect(buildGenerationAuditFindings(healthyInput() as any)).toEqual([]);
  });

  it('flags a stale corpus policy and active anchors that are promotional or media-dependent', () => {
    const input = healthyInput();
    input.corpus = {
      ...input.corpus,
      schemaVersion: 1,
      surfaceRiskAnchorCount: 2,
      surfaceRiskAnchors: [{
        xTweetId: 'x-risky',
        reasons: ['promotional post'],
        content: 'would love to invest and amplify your work https://t.co/promo',
      }],
    };

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'voice_corpus_surface_policy_stale',
        severity: 'high',
        evidence: expect.objectContaining({
          schemaVersion: 1,
          expectedSchemaVersion: 2,
          surfaceRiskAnchorCount: 2,
        }),
      }),
    ]));
  });

  it('reports when critic prose calls a draft finished but the aggregate gate rejects it', () => {
    const input = healthyInput();
    (input.currentPolicyWindow as any).writerOutcomes = {
      criticCalibration: {
        finishedNearMissCount: 1,
        examples: [{
          draftCandidateId: 'draft-conflict',
          judgeScore: 0.91,
          qualityMargin: 0.8589,
          judgeNotes: 'The named timing pick is native; no substantive rewrite is needed.',
          content: 'modal is on the public markets before databricks. i am serious.',
        }],
      },
    };

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'current_policy_critic_score_conflict',
        severity: 'medium',
      }),
    ]));
  });

  it('prioritizes queue starvation and thin quality headroom', () => {
    const input = healthyInput();
    input.queue.qualityEligibleCount = 1;
    input.queue.items = [{
      id: 'tweet-thin',
      qualityEligible: true,
      scores: { qualityMargin: 0.8285 },
      content: 'threshold-hugging draft',
    }];

    const findings = buildGenerationAuditFindings(input as any);

    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'queue_below_minimum',
      'queue_quality_headroom_thin',
    ]));
    expect(findings.find((finding) => finding.code === 'queue_below_minimum')).toMatchObject({
      severity: 'high',
      scope: 'live_state',
      evidence: { eligibleDrafts: 1, deficit: 4 },
    });
    expect(findings.find((finding) => finding.code === 'queue_quality_headroom_thin')).toMatchObject({
      severity: 'high',
      evidence: { tweetId: 'tweet-thin', qualityMargin: 0.8285, hardFloor: 0.86 },
    });
  });

  it('keeps historical quality debt separate from current-policy throughput', () => {
    const input = healthyInput();
    input.currentPolicyWindow = {
      ...input.currentPolicyWindow,
      runsWithSelectedDrafts: 0,
      selectedDraftCount: 0,
      selectionYield: 0,
    };
    input.generationV2.quality.factualIncidentCount = 4;
    input.generationV2.quality.historicalFactualIncidentCount = 4;
    input.generationV2.quality.currentPolicyFactualIncidentCount = 0;
    input.generationV2.quality.userDeleteRate = 0.26;
    input.generationV2.quality.semanticRepeatRate = 0.17;
    input.generationV2.gates.deleteRatePassed = false;
    input.generationV2.gates.semanticRepeatPassed = false;

    const findings = buildGenerationAuditFindings(input as any);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'current_policy_generation_yield_low', scope: 'current_policy' }),
      expect.objectContaining({ code: 'historical_delete_rate_high', scope: 'historical_window' }),
      expect.objectContaining({ code: 'historical_semantic_repeat_rate_high', scope: 'historical_window' }),
    ]));
  });

  it('flags rescue spend that has not saved any current-policy draft', () => {
    const input = healthyInput();
    input.currentPolicyWindow = {
      ...input.currentPolicyWindow,
      runCount: 2,
      runsWithSelectedDrafts: 0,
      selectedDraftCount: 0,
      selectionYield: 0,
      writerOutcomes: {
        groups: [{
          phase: 'rescue',
          model: 'anthropic:claude-fable-5',
          generatedCount: 6,
          finalCriticCount: 2,
          selectedCount: 0,
          selectionRate: 0,
          averageJudgeScore: 0.58,
          averageQualityMargin: 0.69,
          averageNativeVoice: 0.57,
          averageCringeRisk: 0.48,
          topRejectionCodes: [{ value: 'final_cringe_risk', count: 4 }],
        }],
        rescue: {
          targetCount: 3,
          generatedCount: 6,
          finalCriticCount: 2,
          selectedCount: 0,
          selectionRate: 0,
          pairedComparisonCount: 0,
          averageQualityMarginDelta: null,
          pairedComparisons: [],
        },
        nearMisses: [],
      },
    } as any;

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'current_policy_rescue_yield_zero',
        severity: 'high',
        scope: 'current_policy',
      }),
    ]));
  });

  it('separates an idea-to-copy failure from upstream idea starvation', () => {
    const input = healthyInput();
    input.currentPolicyWindow = {
      ...input.currentPolicyWindow,
      runCount: 2,
      runsWithSelectedDrafts: 0,
      selectedDraftCount: 0,
      selectionYield: 0,
      stageThroughput: {
        ideasSelected: 9,
        draftsEligible: 22,
        draftsSelected: 0,
        criticSelectionRate: 0,
      },
      writerOutcomes: {
        groups: [{
          phase: 'initial',
          model: 'openai:gpt-5.6',
          generatedCount: 27,
          finalCriticCount: 15,
          selectedCount: 0,
          selectionRate: 0,
          averageJudgeScore: 0.7,
          averageQualityMargin: 0.76,
          averageNativeVoice: 0.66,
          averageCringeRisk: 0.31,
          topRejectionCodes: [{ value: 'final_quality_margin', count: 15 }],
        }],
        rescue: {
          targetCount: 0,
          generatedCount: 0,
          finalCriticCount: 0,
          selectedCount: 0,
          selectionRate: null,
          pairedComparisonCount: 0,
          averageQualityMarginDelta: null,
          pairedComparisons: [],
        },
        nearMisses: [{
          generationRunId: 'run-gap',
          draftCandidateId: 'draft-gap',
          parentDraftId: null,
          phase: 'initial',
          model: 'openai:gpt-5.6',
          judgeScore: 0.84,
          qualityMargin: 0.844,
          nativeVoice: 0.78,
          casualStartupFit: 0.65,
          novelty: 0.76,
          cringeRisk: 0.2,
          rejectionCodes: ['final_quality_margin'],
          judgeNotes: 'The public move is still an abstract comparison thesis.',
          content: 'A comparative near miss.',
        }],
      },
    } as any;

    const structuralFindings = buildGenerationAuditFindings(input as any);
    expect(structuralFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'current_policy_idea_to_copy_gap',
        severity: 'high',
        scope: 'current_policy',
        evidence: expect.objectContaining({
          stageThroughput: expect.objectContaining({ ideasSelected: 9, draftsEligible: 22, draftsSelected: 0 }),
        }),
      }),
    ]));
    expect(structuralFindings.find((finding) => finding.code === 'current_policy_idea_to_copy_gap')?.action)
      .toContain('Tighten public-move eligibility');

    (input.currentPolicyWindow as any).writerOutcomes.nearMisses[0].judgeNotes =
      'The smallest improvement would be naming the operational task this control would unlock.';
    const consequenceFindings = buildGenerationAuditFindings(input as any);
    expect(consequenceFindings.find((finding) => finding.code === 'current_policy_idea_to_copy_gap')?.action)
      .toContain('bounded, critic-directed repair');
  });

  it('reports repeated category-level investor wrappers in current-policy drafts', () => {
    const input = healthyInput();
    input.currentPolicyWindow.runCount = 2;
    (input.currentPolicyWindow as any).writerOutcomes = buildGenerationWriterOutcomeAudit([{
      generationRunId: 'run-template',
      selectedDraftIds: [],
      stageCounts: {},
      drafts: [{
        draftCandidateId: 'draft-template-one',
        content: 'the robotics company i’d back publishes actuator replacement intervals.',
        mutationRound: 0,
        rejectionCodes: ['final_quality_margin'],
        generationProvider: 'openai',
        generationModel: 'gpt-5.6',
        judgeScore: 0.84,
        judgeBreakdown: { qualityMargin: 0.84 },
      }, {
        draftCandidateId: 'draft-template-two',
        content: 'the inference ASIC startup i’d bet on publishes useful tokens per rack.',
        mutationRound: 0,
        rejectionCodes: ['final_quality_margin'],
        generationProvider: 'openai',
        generationModel: 'gpt-5.6',
        judgeScore: 0.83,
        judgeBreakdown: { qualityMargin: 0.83 },
      }],
    } as any]);

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'current_policy_investor_template_repeated',
        severity: 'high',
        evidence: expect.objectContaining({ genericInvestorSelectionCount: 2 }),
      }),
    ]));
  });

  it('reports when warmed network subjects all fail topic eligibility', () => {
    const input = healthyInput();
    input.sources = {
      ...input.sources,
      warmedNetworkTopicCount: 48,
      operatorTopicSignalEligibleCount: 0,
      operatorTopicSignalRejectionCounts: [
        { value: 'topic_confidence_below_floor', count: 11 },
        { value: 'operator_engagement_below_floor', count: 8 },
      ],
    };

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'network_idea_lane_empty',
        severity: 'high',
        evidence: expect.objectContaining({ warmedNetworkTopicCount: 48 }),
      }),
    ]));
  });

  it('flags final-critic selections that disappear before queue persistence', () => {
    const input = healthyInput();
    input.currentPolicyWindow = {
      ...input.currentPolicyWindow,
      selectedDraftCount: 2,
      persistedSelectedDraftCount: 1,
      unpersistedSelectedDraftCount: 1,
      queueHandoffRate: 0.5,
      unpersistedDrafts: [{
        generationRunId: 'run-lost',
        draftCandidateId: 'draft-lost',
        content: 'approved but never persisted',
      }],
    };

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'current_policy_queue_handoff_loss',
        severity: 'high',
        scope: 'current_policy',
        evidence: expect.objectContaining({ unpersistedSelectedDraftCount: 1, queueHandoffRate: 0.5 }),
      }),
    ]));
  });

  it('raises factual incidents only when they belong to the active policy', () => {
    const historicalOnly = healthyInput();
    historicalOnly.generationV2.quality.factualIncidentCount = 4;
    historicalOnly.generationV2.quality.historicalFactualIncidentCount = 4;
    expect(buildGenerationAuditFindings(historicalOnly as any)
      .some((finding) => finding.code.includes('factual_incidents'))).toBe(false);

    const current = healthyInput();
    current.generationV2.quality.factualIncidentCount = 5;
    current.generationV2.quality.historicalFactualIncidentCount = 5;
    current.generationV2.quality.currentPolicyFactualIncidentCount = 1;
    expect(buildGenerationAuditFindings(current as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'current_policy_factual_incidents', scope: 'current_policy' }),
    ]));
  });

  it('distinguishes historical missing usage from active pricing gaps', () => {
    const input = healthyInput();
    input.generationV2.compute.costDataStatus = 'partial';
    input.generationV2.compute.unknownTokenAttempts = 7;
    input.generationV2.compute.unknownCostCalls = 3;
    input.generationV2.compute.estimatedCostUsd = null;

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'generation_cost_attribution_incomplete',
        title: 'Historical model usage lacks complete token accounting',
        evidence: expect.objectContaining({ activeModelPricingComplete: true }),
      }),
    ]));
  });

  it('flags when editorial sources exist but none can enter the next generation run', () => {
    const input = healthyInput();
    input.sources.generationEligibleCount = 0;

    expect(buildGenerationAuditFindings(input as any)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source_briefs_exhausted',
        severity: 'high',
        scope: 'live_state',
      }),
    ]));
  });
});
