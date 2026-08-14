import { describe, expect, it } from 'vitest';
import { buildGenerationAuditFindings } from '@/lib/generation-quality-audit';

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
      active: true,
      anchorCount: 40,
      targetAnchorCount: 40,
      minimumAnchorCount: 12,
      corpusPurity: 1,
      knownGeneratedAnchorCount: 0,
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
      qualityPolicyVersion: 'publishing-v2-hard-gates-58',
      runCount: 4,
      runsWithSelectedDrafts: 4,
      selectedDraftCount: 5,
      selectionYield: 1,
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
    sources: { editorialEligibleCount: 3, generationEligibleCount: 1 },
  };
}

describe('generation quality audit findings', () => {
  it('returns no findings for a healthy current state and historical window', () => {
    expect(buildGenerationAuditFindings(healthyInput() as any)).toEqual([]);
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
      evidence: { tweetId: 'tweet-thin', qualityMargin: 0.8285, hardFloor: 0.84 },
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
