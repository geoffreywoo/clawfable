import { describe, expect, it } from 'vitest';
import {
  buildFailedStoryAttemptsV2,
  buildGenerationBriefsV2,
  buildGenerationLearningBriefV2,
  buildGenerationWritingConstraintsV2,
  buildIdeaGenerationPromptV2,
  buildPersonalTopicSubjectCuesV2,
  buildTweetWritingPromptV2,
  calculateV2FinalQualityMargin,
  getGenerationV2CircuitPauseUntil,
  getCommittedTweetCopyMemoryV2,
  hasUnsupportedOperatorEvidenceV2,
  getGeoffreyAIBaselineLagIssueV2,
  getGeoffreyAIFutureRejectionCodesV2,
  getGeoffreyFrontierForecastShapeRejectionCodesV2,
  getGeoffreyFinalNoveltyIssueV2,
  getPostcriticRepairModelStackV2,
  getOperatorTopicConstraintIssuesV2,
  getOperatorTopicSignalAttemptDecisionV2,
  hasCrossBriefSubjectCollisionV2,
  getOperatorTopicAttemptPenaltyV2,
  getRequiredFinalQualityMarginV2,
  getV2BoundedRepairCharacterLimit,
  getV2IdeaJudgeRejectionCodes,
  ideaJudgePriorityScore,
  getV2RescueRevisionStrategy,
  meetsV2RescueMarginFloor,
  getSourceAttributionIssueV2,
  getStoryEditorialRejectionCodesV2,
  getStoryGenerationPlanningRejectionCodesV2,
  getSubtractiveTailCandidateContentV2,
  getSubtractiveTailCandidateContentsV2,
  getV2GeneratedWritingIssue,
  isAbstractComparativePublicMoveV2,
  isGenericGeoffreyProductOpsIdeaV2,
  isGenericInvestorSelectionTemplateV2,
  isQuestionDraftV2,
  isGenericOperatorProductWishlistV2,
  isOperatorPremiseReskinV2,
  shouldFlagExplorationHoldoutV2,
  isStoryAlreadyCommittedV2,
  isStoryInEditorialCooldownV2,
  isStoryEditoriallyQualifiedV2,
  isSyntheticGeoffreyStatusFrameV2,
  hasFinishedCriticDiagnosisV2,
  normalizeIdeaCandidatesV2,
  normalizeDirectComparisonPublicMoveV2,
  normalizeDraftContentV2,
  orderV2IdsForPairwise,
  reconcileV2CriticDiagnosis,
  retainsPersonalTopicSubjectV2,
  selectAlternateIdeasV2,
  selectRankedIdeaPortfolioV2,
  selectNativeReactionAnchors,
  selectSubjectNativeReactionPatternV2,
  shouldRunPostcriticRescueV2,
  shouldSpendOnGeoffreySubtractiveRepairV2,
  shouldTryV2SubtractiveTailRepair,
  type GenerationBriefV2,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
} from '@/lib/generation-v2';
import { buildResearchSemanticKey, stableResearchId } from '@/lib/research-utils';
import { getPublishingV2AutopostQualityMargin } from '@/lib/publishing-quality-policy';
import {
  classifyGeoffreyTopicDomain,
  isGeoffreyDeepTechnicalTopic,
  isGeoffreyManufacturingMaterialsTopic,
} from '@/lib/source-planner';
import type { CandidateJudgeBreakdown, GenerationRunTrace, IdeaCandidate, SemanticBlock, SourceDocument, StoryCluster, Tweet } from '@/lib/types';
import { GEOFFREY_NATIVE_EVAL } from './fixtures/geoffrey-quality-eval';
import {
  ANTIFUND_PORTFOLIO_POLICY_VERSION,
  ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
} from '@/lib/antifund-portfolio';

const voiceProfile = {
  tone: 'casual and direct',
  topics: ['AI startups', 'founders', 'health'],
  antiGoals: ['generic explainers'],
  communicationStyle: 'short operator observations',
  summary: 'A founder and investor who cares about company formation, markets, and human performance.',
};

function brief(id: string, topic: string, evidenceMode: GenerationBriefV2['evidenceMode'] = 'operator_opinion'): GenerationBriefV2 {
  return {
    id,
    topic,
    sourceLane: evidenceMode === 'verified_source' ? 'trend_aligned_exploit' : 'manual_core_exploit',
    storyClusterId: evidenceMode === 'verified_source' ? `story-${id}` : null,
    title: topic,
    summary: `A grounded brief about ${topic}`,
    authorOpportunity: 'Make an operator judgment.',
    evidenceMode,
    evidenceIds: evidenceMode === 'verified_source' ? [`source-${id}`] : [],
    sourceDocumentIds: evidenceMode === 'verified_source' ? [`source-${id}`] : [],
    qualifiedClaimIds: evidenceMode === 'verified_source' ? [`claim-${id}`] : [],
    evidence: evidenceMode === 'verified_source' ? [{
      sourceDocumentId: `source-${id}`,
      claimId: `claim-${id}`,
      publisher: 'Test source',
      publishedAt: '2026-08-01T10:00:00.000Z',
      claim: `A verified claim about ${topic}.`,
    }] : [],
    sourceBrief: evidenceMode === 'verified_source' ? 'Verified source.' : 'Operator-owned subject, not evidence.',
    trendTopicId: null,
    trendHeadline: null,
    identityScore: 0.8,
    evidenceScore: evidenceMode === 'verified_source' ? 0.9 : 0.5,
    freshnessScore: 0.7,
  };
}

function rawIdea(briefId: string, claim: string) {
  return {
    briefId,
    publicMove: claim,
    claim,
    tension: 'The visible story conflicts with the operating constraint underneath it.',
    implication: 'Founders should change what they build, measure, or finance next.',
    authorReason: 'This author has repeatedly built companies and allocated capital around this constraint.',
    evidenceIds: [],
    counterargument: 'The constraint may disappear as the market matures.',
    factualRisk: 'low' as const,
  };
}

function run(status: GenerationRunTrace['status'], startedAt: string, error = status === 'failed' ? 'provider failed' : null): GenerationRunTrace {
  return {
    schemaVersion: 2,
    id: `run-${startedAt}-${status}`,
    agentId: 'agent-1',
    pipelineVersion: 'v2',
    requestedCount: 2,
    sourceDocumentIds: [],
    storyClusterIds: [],
    ideaCandidateIds: [],
    draftCandidateIds: [],
    selectedDraftIds: [],
    stageCounts: {},
    rejectionCounts: {},
    modelCalls: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: null,
    startedAt,
    completedAt: startedAt,
    durationMs: 1,
    status,
    error,
  };
}

function repairRun(generated: number, selected: number, startedAt: string): GenerationRunTrace {
  return {
    ...run('empty', startedAt, null),
    stageCounts: {
      postcriticTrimDraftsGenerated: generated,
      postcriticTrimDraftsSelected: selected,
    },
  };
}

function suppressedRepairRun(startedAt: string): GenerationRunTrace {
  return {
    ...run('empty', startedAt, null),
    stageCounts: {
      postcriticTrimSuppressedNegativeValue: 1,
    },
  };
}

describe('Tweet Generation V2', () => {
  it('reserves one verified live story in Geoffrey ranked idea portfolios', () => {
    const briefs = [
      brief('operator-one', 'startup pricing'),
      brief('operator-two', 'AI products'),
      brief('operator-three', 'venture funds'),
      brief('live-story', 'Cognition funding', 'verified_source'),
    ];
    const ideas = [
      { id: 'operator-one', briefId: 'operator-one', topic: 'startups', claim: 'Operator idea one.' },
      { id: 'operator-two', briefId: 'operator-two', topic: 'AI', claim: 'Operator idea two.' },
      { id: 'operator-three', briefId: 'operator-three', topic: 'VC', claim: 'Operator idea three.' },
      { id: 'live-story', briefId: 'live-story', topic: 'Cognition', claim: 'Cognition is discussing a new round.' },
    ] as IdeaCandidate[];

    const selected = selectRankedIdeaPortfolioV2({
      ranking: ['operator-one', 'operator-two', 'operator-three', 'live-story'],
      eligible: ideas,
      briefs,
      voiceProfile: { ...voiceProfile, summary: 'You are @geoffwoo, a founder and investor.' },
      desired: 3,
    });

    expect(selected.map((idea) => idea.id)).toEqual([
      'live-story',
      'operator-one',
      'operator-two',
    ]);
  });

  it('rotates to the strongest judged alternate without repeating a brief', () => {
    const idea = (
      id: string,
      briefId: string,
      judgeScore: number,
      rejectionCodes = ['idea_not_selected'],
    ) => ({
      id,
      briefId,
      status: 'rejected',
      rejectionCodes,
      judgeScore,
      judgeBreakdown: {
        publicMoveStrength: judgeScore,
        nativeReactionPotential: judgeScore,
        sharePotential: judgeScore,
      },
    }) as IdeaCandidate;
    const selected = selectAlternateIdeasV2({
      ideas: [
        idea('already-tried', 'brief-a', 0.94),
        idea('best-a', 'brief-a', 0.88),
        idea('second-a', 'brief-a', 0.84),
        idea('selected-brief', 'brief-b', 0.92),
        idea('best-c', 'brief-c', 0.82),
        idea('failed-judge', 'brief-d', 0.99, ['idea_judge_weak_public_move']),
      ],
      evaluatedIdeaIds: new Set(['already-tried']),
      selectedBriefIds: new Set(['brief-b']),
      briefs: [
        brief('brief-a', 'startups'),
        brief('brief-b', 'venture'),
        brief('brief-c', 'culture'),
        brief('brief-d', 'health'),
      ],
      voiceProfile,
      desired: 2,
    });

    expect(selected.map((entry) => entry.id)).toEqual(['best-a', 'best-c']);
  });

  it('carries Geoffrey technical-lane caps into alternate idea selection', () => {
    const idea = (
      id: string,
      briefId: string,
      topic: string,
      claim: string,
      judgeScore: number,
      status: IdeaCandidate['status'] = 'rejected',
      rejectionCodes = ['idea_not_selected'],
    ) => ({
      id,
      briefId,
      topic,
      claim,
      tension: claim,
      implication: claim,
      publicMove: claim,
      status,
      rejectionCodes,
      judgeScore,
      judgeBreakdown: {
        publicMoveStrength: judgeScore,
        nativeReactionPotential: judgeScore,
        sharePotential: judgeScore,
      },
    }) as IdeaCandidate;
    const ideas = [
      idea('fusion-tried', 'brief-fusion', 'energy', 'fusion tritium breeding plan', 0.9, 'selected', []),
      idea('robotics-alternate', 'brief-robotics', 'robotics', 'home robotics hardware', 0.96),
      idea('fusion-alternate', 'brief-fusion', 'energy', 'fusion first-wall materials', 0.94),
      idea('culture-alternate', 'brief-culture', 'culture', 'founder status and taste', 0.84),
    ];

    const selected = selectAlternateIdeasV2({
      ideas,
      evaluatedIdeaIds: new Set(['fusion-tried']),
      selectedBriefIds: new Set(),
      briefs: [
        brief('brief-fusion', 'fusion energy'),
        brief('brief-robotics', 'home robotics'),
        brief('brief-culture', 'founder culture'),
      ],
      voiceProfile: { ...voiceProfile, summary: 'You are @geoffwoo, a founder and investor.' },
      desired: 3,
    });

    expect(selected.map((entry) => entry.id)).toEqual(['culture-alternate']);
  });

  it('uses same-subject native posts as structured reaction evidence without exposing prose', () => {
    const pattern = selectSubjectNativeReactionPatternV2({
      topic: 'cognition',
      claim: 'Cognition is discussing a new round at a $40 billion valuation.',
      tension: 'The company now needs a much larger product outcome.',
      implication: 'The valuation changes the product bar.',
    }, [{
      id: 'native-cognition-call',
      topic: 'AI',
      content: 'google should buy @cognition for $200b and make the founder ceo',
    }, {
      id: 'unrelated-startup-post',
      topic: 'startups',
      content: 'founders should send investor updates when they have useful context',
    }]);

    expect(pattern).toEqual({
      reactionMode: 'named_call',
      lengthBand: 'short',
      paragraphBand: 'single',
      usesFirstPerson: false,
    });
    expect(pattern).not.toHaveProperty('content');
  });

  it('targets account-specific autonomous headroom for live and production-shadow generation only', () => {
    const geoffreyVoiceProfile = {
      communicationStyle: 'You are @geoffwoo. Write in the operator voice.',
      summary: 'Founder and investor.',
      tone: 'direct',
      topics: ['startups'],
      antiGoals: [],
    } as any;
    expect(getRequiredFinalQualityMarginV2({ mode: 'live' })).toBe(0.86);
    expect(getRequiredFinalQualityMarginV2({ mode: 'preview', requireAutopostQuality: true })).toBe(0.86);
    expect(getRequiredFinalQualityMarginV2({ mode: 'live', voiceProfile: geoffreyVoiceProfile })).toBe(0.87);
    expect(getRequiredFinalQualityMarginV2({
      mode: 'preview',
      requireAutopostQuality: true,
      voiceProfile: geoffreyVoiceProfile,
    })).toBe(0.87);
    expect(getRequiredFinalQualityMarginV2({ mode: 'preview', persistArtifacts: false })).toBe(0.81);
    expect(getRequiredFinalQualityMarginV2({
      mode: 'manual',
      voiceProfile: geoffreyVoiceProfile,
    })).toBe(0.81);
    expect(getRequiredFinalQualityMarginV2({ mode: 'manual' })).toBe(0.81);
    expect(getRequiredFinalQualityMarginV2({})).toBe(0.86);
    expect(getPublishingV2AutopostQualityMargin('@geoffwoo')).toBe(0.87);
    expect(getPublishingV2AutopostQualityMargin('geoffreywoo')).toBe(0.87);
    expect(getPublishingV2AutopostQualityMargin('another-founder')).toBe(0.86);
  });

  it('keeps raw critic confidence from masking a deterministic margin miss', () => {
    expect(reconcileV2CriticDiagnosis(
      'The named timing pick is native; no substantive rewrite is needed.',
      ['final_quality_margin'],
      0.8694,
      0.87,
    )).toContain('do not clear the 0.870 autopost bar');
    expect(reconcileV2CriticDiagnosis(
      'The middle is too abstract and needs one named consequence.',
      ['final_quality_margin'],
      0.85,
      0.87,
    )).toBe('The middle is too abstract and needs one named consequence.');
  });

  it('weights literal operator plausibility above extra casual texture in final margin calibration', () => {
    const observed = calculateV2FinalQualityMargin({
      overall: 0.88,
      insight: 0.84,
      operatorPlausibility: 0.91,
    }, {
      nativeVoice: 0.817,
      casualStartupFit: 0.758,
      cringeRisk: 0.2336,
      stiffnessRisk: 0.01,
      voiceDriftRisk: 0,
      generatedPatternRisk: 0,
      manualAnchorReskinRisk: 0.03,
    } as any);
    const lowPlausibility = calculateV2FinalQualityMargin({
      overall: 0.88,
      insight: 0.84,
      operatorPlausibility: 0.55,
    }, {
      nativeVoice: 0.55,
      casualStartupFit: 0.9,
      cringeRisk: 0.2336,
      stiffnessRisk: 0.01,
      voiceDriftRisk: 0,
      generatedPatternRisk: 0,
      manualAnchorReskinRisk: 0.03,
    } as any);

    expect(observed).toBeGreaterThanOrEqual(0.86);
    expect(lowPlausibility).toBeLessThan(0.86);
  });

  it('blocks obvious low-novelty Geoffrey copy without applying the account gate globally', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    expect(getGeoffreyFinalNoveltyIssueV2(geoffreyVoice, 0.55)).toBe('final_novelty_below_floor');
    expect(getGeoffreyFinalNoveltyIssueV2(geoffreyVoice, 0.62)).toBeNull();
    expect(getGeoffreyFinalNoveltyIssueV2(voiceProfile, 0.4)).toBeNull();
  });

  it('does not lose a critic rescue to one-basis-point score rounding', () => {
    expect(meetsV2RescueMarginFloor(0.7799, 0.78)).toBe(true);
    expect(meetsV2RescueMarginFloor(0.7798, 0.78)).toBe(false);
  });

  it('bounds a surgical repair close to the parent instead of allowing a new essay', () => {
    expect(getV2BoundedRepairCharacterLimit('x'.repeat(50))).toBe(98);
    expect(getV2BoundedRepairCharacterLimit('x'.repeat(300))).toBe(360);
    expect(getV2BoundedRepairCharacterLimit('x'.repeat(1100))).toBe(1200);
  });

  it('ranks floor-passing ideas by blended strength, not their weakest off-lane dimension', () => {
    const bold = {
      evidenceFidelity: 0.62,
      authorFit: 0.86,
      consequence: 0.88,
      distinctiveness: 0.95,
      nativeReactionPotential: 0.9,
      publicMoveStrength: 0.94,
      sharePotential: 0.92,
    };
    const flat = {
      evidenceFidelity: 0.8,
      authorFit: 0.78,
      consequence: 0.72,
      distinctiveness: 0.7,
      nativeReactionPotential: 0.78,
      publicMoveStrength: 0.76,
      sharePotential: 0.7,
    };

    // Under min-aggregation, bold would score 0.62 and lose to flat's 0.7.
    expect(ideaJudgePriorityScore(bold)).toBeGreaterThan(ideaJudgePriorityScore(flat));
    expect(ideaJudgePriorityScore(bold)).toBeGreaterThan(0.85);
    expect(ideaJudgePriorityScore(flat)).toBeLessThan(0.8);
  });

  it('requires stronger idea consequence and native reaction before spending Geoffrey copy calls', () => {
    const borderline = {
      evidenceFidelity: 0.95,
      authorFit: 0.72,
      consequence: 0.68,
      distinctiveness: 0.68,
      nativeReactionPotential: 0.72,
      publicMoveStrength: 0.72,
      sharePotential: 0.68,
      frontierLead: 1,
      aiBullishness: 1,
      trajectoryConviction: 1,
      forecastGrounding: 1,
      exponentialIntuition: 1,
    };
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };

    expect(getV2IdeaJudgeRejectionCodes(borderline, voiceProfile)).toEqual([]);
    expect(getV2IdeaJudgeRejectionCodes(borderline, geoffreyVoice)).toEqual(expect.arrayContaining([
      'idea_judge_weak_author_fit',
      'idea_judge_low_consequence',
      'idea_judge_generic_premise',
      'idea_judge_weak_native_reaction',
      'idea_judge_weak_public_move',
      'idea_judge_low_share_potential',
    ]));
  });

  it('blocks AI premises that forecast Geoffrey current baselines', () => {
    expect(getGeoffreyAIBaselineLagIssueV2(
      'i’d bet people start using ChatGPT as a generic verb before OpenAI hits a trillion-dollar valuation.',
    )).toBe('openai_trillion_is_current_baseline');
    expect(getGeoffreyAIBaselineLagIssueV2(
      'i want Scott Wu to make Cognition so good that elite engineers choose Devin for their hardest work',
    )).toBe('frontier_agent_adoption_is_current_baseline');
    expect(getGeoffreyAIBaselineLagIssueV2(
      'frontier coding agents are already good enough. the next $100b software company might employ fewer people than this fund.',
    )).toBeNull();
    expect(getGeoffreyAIBaselineLagIssueV2(
      'humanoid robots will start working in factories next year',
    )).toBe('industrial_robot_pilots_are_current_baseline');
  });

  it('requires frontier lead and bullish trajectory conviction for Geoffrey AI ideas', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const lagging = {
      evidenceFidelity: 0.95,
      authorFit: 0.9,
      consequence: 0.9,
      distinctiveness: 0.9,
      nativeReactionPotential: 0.9,
      publicMoveStrength: 0.9,
      sharePotential: 0.9,
      frontierLead: 0.25,
      aiBullishness: 0.4,
      trajectoryConviction: 0.4,
      forecastGrounding: 0.4,
      exponentialIntuition: 0.4,
    };

    expect(getV2IdeaJudgeRejectionCodes(lagging, geoffreyVoice, 'OpenAI ChatGPT AI')).toEqual(
      expect.arrayContaining([
        'idea_judge_lagging_frontier_baseline',
        'idea_judge_timid_ai_posture',
        'idea_judge_weak_trajectory_conviction',
        'idea_judge_weak_forecast_grounding',
        'idea_judge_linear_extrapolation',
      ]),
    );
    expect(getV2IdeaJudgeRejectionCodes(lagging, geoffreyVoice, 'fusion reactor')).toEqual([]);
    expect(getGeoffreyAIFutureRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'OpenAI coding agents',
      content: 'coding agents will matter eventually',
      frontierLead: 0.25,
      aiBullishness: 0.4,
      trajectoryConviction: 0.4,
      forecastGrounding: 0.4,
      exponentialIntuition: 0.4,
    })).toEqual(expect.arrayContaining([
      'final_frontier_lead_below_floor',
      'final_ai_bullishness_below_floor',
      'final_trajectory_conviction_below_floor',
      'final_forecast_grounding_below_floor',
      'final_exponential_intuition_below_floor',
    ]));
    expect(getGeoffreyAIFutureRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'fusion reactor',
      content: 'fusion could matter eventually',
      frontierLead: 0.25,
      aiBullishness: 0.4,
      trajectoryConviction: 0.4,
      forecastGrounding: 0.4,
      exponentialIntuition: 0.4,
    })).toEqual([]);
    expect(getGeoffreyAIFutureRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'OpenAI ChatGPT',
      content: 'i’d bet people start using ChatGPT as a generic verb before OpenAI hits a trillion-dollar valuation.',
      frontierLead: 0.95,
      aiBullishness: 0.95,
      trajectoryConviction: 0.95,
      forecastGrounding: 0.95,
      exponentialIntuition: 0.95,
    })).toContain('final_frontier_baseline_lag');
  });

  it('does not let high model scores turn a current AI reaction into a frontier forecast', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const reaction = 'Anthropic discussing $6B for Decart makes normal startup acquisition math feel obsolete. Early talks, per Fortune.';
    const forecast = 'within 12 months, Anthropic will make frontier acquisitions routine once each model cycle makes buying a team faster than recruiting it.';

    expect(getGeoffreyFrontierForecastShapeRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'Anthropic AI acquisition',
      content: reaction,
      stage: 'idea',
    })).toEqual(expect.arrayContaining([
      'idea_frontier_forecast_missing',
      'idea_frontier_owned_prediction_missing',
      'idea_frontier_near_term_horizon_missing',
      'idea_frontier_grounding_shape_missing',
      'idea_frontier_exponential_mechanism_missing',
    ]));
    expect(getGeoffreyAIFutureRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'Anthropic AI acquisition',
      content: reaction,
      frontierLead: 0.95,
      aiBullishness: 0.95,
      trajectoryConviction: 0.95,
      forecastGrounding: 0.95,
      exponentialIntuition: 0.95,
    })).toEqual(expect.arrayContaining([
      'final_frontier_forecast_missing',
      'final_frontier_near_term_horizon_missing',
      'final_frontier_exponential_mechanism_missing',
    ]));
    expect(getGeoffreyFrontierForecastShapeRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'Anthropic AI acquisition',
      content: forecast,
      stage: 'idea',
    })).toEqual([]);
    expect(getGeoffreyFrontierForecastShapeRejectionCodesV2({
      voiceProfile: geoffreyVoice,
      topicContext: 'fusion reactor',
      content: reaction,
      stage: 'idea',
    })).toEqual([]);
  });

  it('rejects reaction-only Geoffrey AI ideas before copy generation', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const reaction = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'Anthropic discussing $6B for Decart makes normal startup acquisition math feel obsolete.',
      )],
      agentId: 'agent-1',
      runId: 'run-frontier-shape-reaction',
      briefs: [brief('operator', 'Anthropic AI acquisition')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-22T00:00:00.000Z',
    })[0];
    const forecast = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'within 12 months, Anthropic will make frontier acquisitions routine once each model cycle makes buying a team faster than recruiting it.',
      )],
      agentId: 'agent-1',
      runId: 'run-frontier-shape-forecast',
      briefs: [brief('operator', 'Anthropic AI acquisition')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-22T00:00:00.000Z',
    })[0];

    expect(reaction.rejectionCodes).toContain('idea_frontier_forecast_missing');
    expect(reaction.rejectionCodes).toContain('idea_frontier_exponential_mechanism_missing');
    expect(forecast.rejectionCodes.some((code) => code.startsWith('idea_frontier_'))).toBe(false);
    expect(forecast.rejectionCodes).not.toContain('unsupported_operator_fact');
  });

  it('rejects lagging AI baselines before paying the idea judge', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const stale = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'i want Scott Wu to make Cognition so good that elite engineers choose Devin for their hardest work',
      )],
      agentId: 'agent-1',
      runId: 'run-frontier-baseline-stale',
      briefs: [brief('operator', 'AI coding agents')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-22T00:00:00.000Z',
    })[0];
    const forward = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'coding agents already do frontier work. the first ten-person software company at $10b will look overstaffed.',
      )],
      agentId: 'agent-1',
      runId: 'run-frontier-baseline-forward',
      briefs: [brief('operator', 'AI coding agents')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-22T00:00:00.000Z',
    })[0];

    expect(stale.rejectionCodes).toContain('behind_frontier_baseline');
    expect(forward.rejectionCodes).not.toContain('behind_frontier_baseline');
  });

  it('rejects abstract comparison theses for Geoffrey before copy generation', () => {
    const rejectedMoves = [
      'ChatGPT could become more valuable as a runtime than as a model showcase.',
      'Cognition gets more interesting as a founder-shaped company instead of a polished one.',
      'I prefer selective forgetting to exhaustive memory in ChatGPT.',
      'AI self-help becomes compelling when it punctures grand narratives rather than manufacturing them.',
    ];
    const directMoves = [
      'Google should be willing to cannibalize Chrome for Gemini.',
      'ChatGPT should default to forgetting most memories.',
      'i think oai and ant are 5-10T before 2029.',
    ];
    expect(rejectedMoves.every(isAbstractComparativePublicMoveV2)).toBe(true);
    expect(directMoves.every((move) => !isAbstractComparativePublicMoveV2(move))).toBe(true);

    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const badMove = rejectedMoves[0];
    const geoffreyIdea = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', badMove)],
      agentId: 'agent-1',
      runId: 'run-one-sided-geoffrey',
      briefs: [brief('operator', 'AI')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-14T06:00:00.000Z',
    })[0];
    const genericIdea = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', badMove)],
      agentId: 'agent-1',
      runId: 'run-one-sided-generic',
      briefs: [brief('operator', 'AI')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-14T06:00:00.000Z',
    })[0];

    expect(geoffreyIdea.rejectionCodes).toContain('abstract_comparative_public_move');
    expect(genericIdea.rejectionCodes).not.toContain('abstract_comparative_public_move');

    const comparativeClaim = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('operator', 'Google should make Gemini the Workspace interface.'),
        publicMove: 'Google should make Gemini the Workspace interface.',
        claim: 'Gemini is more interesting as the product than another Workspace sidebar.',
      }],
      agentId: 'agent-1',
      runId: 'run-one-sided-claim',
      briefs: [brief('operator', 'AI')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-14T06:00:00.000Z',
    })[0];
    expect(comparativeClaim.rejectionCodes).toContain('abstract_comparative_public_move');
  });

  it('rejects generic AI product-governance takes for Geoffrey before copy generation', () => {
    const genericProductOps = [
      'The first AI agent I would trust with real authority is one that can freeze a software release.',
      'OpenAI should make ChatGPT the place where agents earn permission to act, not just where users ask them to think.',
      'OpenAI will be judged as a software company the minute ChatGPT can reliably finish one messy week-long task.',
      'Let it block the bad release. That is the product I would trust with actual authority.',
    ];
    const nativeMoves = [
      'OpenAI should ship a model that maintains one small open-source repository for a year under its own name.',
      'i think oai and ant are 5-10T before 2029.',
      'google should be willing to cannibalize chrome for gemini.',
    ];

    expect(genericProductOps.every(isGenericGeoffreyProductOpsIdeaV2)).toBe(true);
    expect(nativeMoves.every((move) => !isGenericGeoffreyProductOpsIdeaV2(move))).toBe(true);

    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const idea = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', genericProductOps[0])],
      agentId: 'agent-1',
      runId: 'run-product-ops-geoffrey',
      briefs: [brief('operator', 'AI')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-14T06:00:00.000Z',
    })[0];

    expect(idea.rejectionCodes).toContain('generic_product_ops_take');
  });

  it('rejects manufactured status framing before Geoffrey copy generation', () => {
    const syntheticMoves = [
      'Persistent AI memory will become a status object inside the Tony Robbins crowd.',
      'Factory-floor credibility will become a status asset for AI company formation.',
      'Taking a lower seed valuation will be the higher-status move.',
      'Repair time becomes the new flex in robotics.',
    ];
    const directMoves = [
      'i think oai and ant are 5-10T before 2029.',
      'Google should be willing to cannibalize Chrome for Gemini.',
      'why does every robotics demo hide the repair log?',
    ];

    expect(syntheticMoves.every(isSyntheticGeoffreyStatusFrameV2)).toBe(true);
    expect(directMoves.every((move) => !isSyntheticGeoffreyStatusFrameV2(move))).toBe(true);

    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const idea = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', syntheticMoves[0])],
      agentId: 'agent-1',
      runId: 'run-synthetic-status-geoffrey',
      briefs: [brief('operator', 'AI')],
      voiceProfile: geoffreyVoice,
      recentPosts: [],
      blocks: [],
      now: '2026-08-14T06:00:00.000Z',
    })[0];

    expect(idea.rejectionCodes).toContain('synthetic_status_framing');
  });

  it('detects reusable category-level investor wrappers without blocking direct calls', () => {
    expect(isGenericInvestorSelectionTemplateV2(
      'the robotics reliability company i’d back is a thermal-cycling lab with software attached.',
    )).toBe(true);
    expect(isGenericInvestorSelectionTemplateV2(
      'the inference ASIC startup i’d bet on publishes useful tokens per rack.',
    )).toBe(true);
    expect(isGenericInvestorSelectionTemplateV2(
      'google should make gemini the workspace interface.',
    )).toBe(false);
    expect(isGenericInvestorSelectionTemplateV2(
      'useful tokens per rack is the benchmark i care about.',
    )).toBe(false);

    const prompt = JSON.parse(buildTweetWritingPromptV2({
      id: 'idea-direct-criterion',
      topic: 'robotics',
      publicMove: 'Robotics companies should publish actuator replacement intervals.',
      claim: 'Replacement intervals are the decision criterion.',
      tension: 'Demo dexterity does not establish production-duty uptime.',
      implication: 'I would change which company I back based on repair frequency.',
      counterargument: 'Dexterity can still determine whether the robot is useful.',
    } as IdeaCandidate, brief('robotics', 'robotics'), [], []));
    expect(prompt.responseContract.variantMoves[1].instruction).toContain('never wrap a category');
    expect(prompt.responseContract.variantMoves[0]).toEqual(expect.objectContaining({
      consequenceRole: 'reaction_only',
      instruction: expect.stringContaining('bare spoken version'),
    }));
    expect(prompt.responseContract.variantMoves[1]).toEqual(expect.objectContaining({
      consequenceRole: 'reaction_only',
      instruction: expect.stringContaining('Stop at the direct reaction'),
    }));
    expect(prompt.responseContract.variantMoves[2]).toEqual(expect.objectContaining({
      consequenceRole: 'approved_consequence',
      instruction: expect.stringContaining('same casual thought'),
    }));
    expect(prompt.responseContract.diversityContract).toContain('Slot 1 is the bare spoken verdict');

    const singleWriterPrompt = JSON.parse(buildTweetWritingPromptV2(
      rawIdea('operator', 'ChatGPT is the OpenAI asset I would bet on.') as IdeaCandidate,
      brief('operator', 'OpenAI'),
      [],
      [],
      undefined,
      undefined,
      undefined,
      'reconceive',
      1,
    ));
    expect(singleWriterPrompt.responseContract.variantMoves).toEqual([
      expect.objectContaining({ move: 'blunt_reaction' }),
    ]);
    expect(singleWriterPrompt.factualWritingContract).toContain('millions or billions');

    const pairedInitialPrompt = JSON.parse(buildTweetWritingPromptV2(
      rawIdea('operator', 'ChatGPT is the OpenAI asset I would bet on.') as IdeaCandidate,
      brief('operator', 'OpenAI'),
      [],
      [{ id: 'anchor-1', content: 'openai should name gpt-6 god?', topic: 'AI' }, {
        id: 'anchor-2', content: 'google should buy cognition for $200b', topic: 'AI',
      }],
      undefined,
      undefined,
      undefined,
      'reconceive',
      2,
    ));
    expect(pairedInitialPrompt.responseContract.variantMoves).toHaveLength(2);
    expect(pairedInitialPrompt.responseContract.variantMoves[0]).not.toMatchObject({ move: 'critic_repair' });
    expect(pairedInitialPrompt.voiceTransferContract.slotRegisterAnchors).toHaveLength(2);
  });

  it('repairs a clean margin-only miss but reconceives structural or multi-gate failures', () => {
    expect(getV2RescueRevisionStrategy(['final_quality_margin'])).toBe('critic_surgical');
    expect(getV2RescueRevisionStrategy(['final_confidence_below_floor', 'final_quality_margin'])).toBe('reconceive');
    expect(getV2RescueRevisionStrategy(['copy_judge_voice_mismatch', 'final_quality_margin'])).toBe('reconceive');
    expect(getV2RescueRevisionStrategy(['final_cringe_risk', 'final_quality_margin'])).toBe('reconceive');
    expect(getV2RescueRevisionStrategy([
      'final_frontier_near_term_horizon_missing',
      'final_frontier_exponential_mechanism_missing',
    ])).toBe('reconceive');
    expect(getV2RescueRevisionStrategy(
      ['final_quality_margin'],
      'The middle reads like a constructed reveal from an analyst account.',
    )).toBe('reconceive');
    expect(getV2RescueRevisionStrategy(
      ['final_quality_margin'],
      'The public move is still an abstract comparison thesis.',
    )).toBe('reconceive');
    expect(getV2RescueRevisionStrategy(
      ['final_quality_margin'],
      'The native position is sound; cut one hedge and stop.',
    )).toBe('critic_surgical');
  });

  it('only repairs Geoffrey margin-only near misses with strong native headroom', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    expect(shouldRunPostcriticRescueV2(geoffreyVoice)).toBe(false);
    expect(shouldRunPostcriticRescueV2(
      geoffreyVoice,
      ['final_quality_margin'],
      'The smallest improvement would be naming the operational task this control would unlock.',
      0.859,
    )).toBe(false);
    const nativeNearMiss = {
      nativeVoice: 0.81,
      casualStartupFit: 0.76,
      cringeRisk: 0.2,
    } as CandidateJudgeBreakdown;
    expect(shouldRunPostcriticRescueV2(
      geoffreyVoice,
      ['final_quality_margin'],
      'The direct company judgment is sound; remove the hedge and stop.',
      0.856,
      nativeNearMiss,
    )).toBe(true);
    expect(shouldRunPostcriticRescueV2(
      geoffreyVoice,
      ['final_cringe_risk', 'final_quality_margin'],
      'The ending still reads like a manufactured reveal.',
      0.856,
      nativeNearMiss,
    )).toBe(false);
    expect(shouldRunPostcriticRescueV2(
      geoffreyVoice,
      [
        'final_frontier_near_term_horizon_missing',
        'final_frontier_exponential_mechanism_missing',
        'final_quality_margin',
      ],
      'The native robotics call is strong but it needs an explicit near-term threshold forecast.',
      0.861,
      { ...nativeNearMiss, voiceDriftRisk: 0.1 },
    )).toBe(true);
    expect(shouldRunPostcriticRescueV2(
      geoffreyVoice,
      [
        'final_frontier_near_term_horizon_missing',
        'final_frontier_exponential_mechanism_missing',
      ],
      'The current-event reaction has no forecast shape.',
      0.72,
      { ...nativeNearMiss, voiceDriftRisk: 0.1 },
    )).toBe(false);
    expect(shouldRunPostcriticRescueV2(
      geoffreyVoice,
      ['final_quality_margin'],
      'The direct company judgment is sound; remove the hedge and stop.',
      0.856,
      { ...nativeNearMiss, cringeRisk: 0.3 },
    )).toBe(false);
    expect(shouldRunPostcriticRescueV2(voiceProfile)).toBe(true);
    expect(getPostcriticRepairModelStackV2('publishing_v2_gpt_control', geoffreyVoice)).toBe('publishing_v2_gpt_control');
    expect(getPostcriticRepairModelStackV2('publishing_v2_gpt_control', voiceProfile)).toBe('publishing_v2_fable_control');
  });

  it('stops spending on Geoffrey tail trims after a zero-yield live window', () => {
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    expect(shouldSpendOnGeoffreySubtractiveRepairV2(geoffreyVoice, [
      repairRun(1, 0, '2026-08-15T04:00:00.000Z'),
      repairRun(1, 0, '2026-08-15T03:00:00.000Z'),
      repairRun(1, 0, '2026-08-15T02:00:00.000Z'),
      repairRun(1, 0, '2026-08-15T01:00:00.000Z'),
    ])).toBe(false);
    expect(shouldSpendOnGeoffreySubtractiveRepairV2(geoffreyVoice, [
      repairRun(4, 1, '2026-08-15T04:00:00.000Z'),
    ])).toBe(true);
    expect(shouldSpendOnGeoffreySubtractiveRepairV2(geoffreyVoice, [
      suppressedRepairRun('2026-08-15T08:00:00.000Z'),
      suppressedRepairRun('2026-08-15T07:00:00.000Z'),
      suppressedRepairRun('2026-08-15T06:00:00.000Z'),
      repairRun(1, 0, '2026-08-15T05:00:00.000Z'),
      repairRun(1, 0, '2026-08-15T04:00:00.000Z'),
      repairRun(1, 0, '2026-08-15T03:00:00.000Z'),
    ])).toBe(false);
    expect(shouldSpendOnGeoffreySubtractiveRepairV2(voiceProfile, [
      repairRun(8, 0, '2026-08-15T04:00:00.000Z'),
    ])).toBe(true);
  });

  it('tries deletion-only repair for a near-autopost margin miss without requiring magic critic wording', () => {
    expect(hasFinishedCriticDiagnosisV2(
      'The named timing pick is native; no substantive rewrite is needed.',
    )).toBe(true);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_quality_margin'],
      'The named timing pick is native; no substantive rewrite is needed.',
      0.867,
      'Databricks goes public before Modal. Modal is still the company i would rather own.',
    )).toBe(false);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_quality_margin'],
      'Clarify that serviceability makes the gross-margin claim credible.',
      0.8497,
      "publish the field-service interval. until then it's a video.",
    )).toBe(true);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_quality_margin'],
      'Clarify the mechanism.',
      0.8399,
      "publish the field-service interval. until then it's a video.",
    )).toBe(false);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_quality_margin'],
      'Make the final claim slightly less absolute.',
      0.85938,
      "anthropic could be the best company of this cycle. quality does not win that fight.",
    )).toBe(true);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_quality_margin'],
      'Make the final claim slightly less absolute.',
      0.8499,
      "anthropic could be the best company of this cycle. quality does not win that fight.",
    )).toBe(false);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_quality_margin'],
      'Cut the explanatory closer and stop.',
      0.8,
      'the concrete call. an ordinary tail.',
    )).toBe(true);
    expect(shouldTryV2SubtractiveTailRepair(
      ['final_cringe_risk', 'final_quality_margin'],
      'Cut the explanatory closer and stop.',
      0.85,
      "publish the field-service interval. until then it's a video.",
    )).toBe(false);
  });

  it('leads voice transfer with a same-register native posture and keeps cross-topic range', () => {
    const anchors = [
      { id: 'personal-question', topic: 'personal', content: 'quitting caffeine for two weeks. who is in?' },
      { id: 'ai-rough', topic: 'AI', content: 'ai will rule the world. the action surface is different. human shells.' },
      { id: 'crypto-number', topic: 'crypto', content: 'he margin called 5% of the country with 4x leverage' },
      { id: 'market-position', topic: 'investing', content: 'i bought more $MU today but did not have enough courage to swing big' },
    ];

    const selected = selectNativeReactionAnchors(
      anchors,
      ['Opendoor in startups markets', 'I distrust growth and would want to own it after shrinking.'],
      3,
    );

    expect(selected.map((anchor) => anchor.id)).toEqual([
      'market-position',
      'personal-question',
      'ai-rough',
    ]);
  });

  it('leads a subject question with a native question move before local-register range', () => {
    const anchors = [
      { id: 'ai-number', topic: 'AI', content: 'one gw rubin may replace 20 racks. only game for the next 2 years.' },
      { id: 'startup-long', topic: 'startups', content: 'i read every investor update. idgaf about the polish. tell me what broke.' },
      { id: 'personal-question', topic: 'personal', content: 'quitting caffeine for two weeks. who is in?' },
      { id: 'ai-rough', topic: 'AI', content: 'ai will rule the world.\n\nthe action surface is different.\n\nhuman shells.' },
    ];

    const selected = selectNativeReactionAnchors(
      anchors,
      ['AI software', 'Should Anthropic become a software company?'],
      3,
    );

    expect(selected.map((anchor) => anchor.id)).toEqual([
      'personal-question',
      'ai-number',
      'startup-long',
    ]);

    const prompt = JSON.parse(buildTweetWritingPromptV2(
      rawIdea('AI software', 'Should Anthropic become a software company?') as IdeaCandidate,
      brief('operator', 'AI software'),
      [],
      selected,
    ));
    expect(prompt.responseContract.variantMoves).toEqual([
      expect.objectContaining({ move: 'direct_question', voiceAnchorId: 'personal-question' }),
      expect.objectContaining({ move: 'quantified_position', voiceAnchorId: 'ai-number' }),
      expect.objectContaining({ move: 'first_person_position', voiceAnchorId: 'startup-long' }),
    ]);
  });

  it('keeps a declarative technology idea in its local register before cross-topic posture', () => {
    const selected = selectNativeReactionAnchors([
      { id: 'culture-blunt', topic: 'culture', content: 'do not root for a downfall. it only exposes insecurity.' },
      { id: 'ai-rough', topic: 'AI', content: 'ai changes the action surface.\n\nthe next move is weird.\n\nhuman shells.' },
      { id: 'startup-call', topic: 'startups', content: 'my philosophy for a founder/ceo: win first, explain later.' },
    ], [
      'AI software',
      'Google could make standalone AI software feel temporary.',
    ], 3);

    expect(selected.map((anchor) => anchor.id)).toEqual([
      'ai-rough',
      'culture-blunt',
      'startup-call',
    ]);
  });

  it('preserves native paragraph rhythm while normalizing draft whitespace', () => {
    expect(normalizeDraftContentV2('  first beat  \r\n\r\n  second   beat  ')).toBe('first beat\n\nsecond beat');
  });

  it('builds only deletion-based tail candidates from multi-sentence near misses', () => {
    expect(getSubtractiveTailCandidateContentV2(
      "openai doesn't need the best model to get way bigger. chatgpt is the bet. billions of people know one name for ai.",
    )).toBe("openai doesn't need the best model to get way bigger. chatgpt is the bet.");
    expect(getSubtractiveTailCandidateContentsV2(
      'i would pay for refusals as good as code gen. implementation is table stakes. this closer should go.',
    )).toEqual([
      'i would pay for refusals as good as code gen. implementation is table stakes.',
      'i would pay for refusals as good as code gen.',
    ]);
    expect(getSubtractiveTailCandidateContentV2('chatgpt is the bet.')).toBeNull();
    expect(getSubtractiveTailCandidateContentV2('too short. no.')).toBeNull();
  });

  it('requires attributed source claims to stay attributed in public copy', () => {
    const attributedSource = {
      publisher: '@justindross',
      entities: ['Coverage'],
      claims: [{
        text: 'The author says their company protects $50B in revenue across more than 1,000 clients.',
      }],
    } as SourceDocument;
    const directSource = {
      claims: [{
        text: 'Coverage protects $50B in revenue across more than 1,000 clients.',
      }],
    } as SourceDocument;

    expect(getSourceAttributionIssueV2(
      'coverage protects $50B in revenue across more than 1,000 clients.',
      [attributedSource],
    )).toMatch(/attribution was dropped/i);
    expect(getSourceAttributionIssueV2(
      'coverage says it protects $50B in revenue across more than 1,000 clients.',
      [attributedSource],
    )).toBeNull();
    expect(getSourceAttributionIssueV2(
      'its founder says it protects $50B in revenue across more than 1,000 clients.',
      [attributedSource],
    )).toBeNull();
    expect(getSourceAttributionIssueV2(
      'coverage’s founder says it protects $50B in revenue across more than 1,000 clients.',
      [attributedSource],
    )).toBeNull();
    expect(getSourceAttributionIssueV2(
      'the number says coverage protects $50B in revenue across more than 1,000 clients.',
      [attributedSource],
    )).toMatch(/attribution was dropped/i);
    expect(getSourceAttributionIssueV2(
      'according to coverage, it protects $50B in revenue across more than 1,000 clients.',
      [attributedSource],
    )).toBeNull();
    expect(getSourceAttributionIssueV2(
      'coverage protects $50B in revenue across more than 1,000 clients.',
      [directSource],
    )).toBeNull();
  });

  it('creates four distinct briefs for a normal two-post refill', () => {
    const briefs = buildGenerationBriefsV2({
      count: 2,
      requestedTopic: null,
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'AI hardware'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(briefs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(briefs.map((entry) => entry.topic.toLowerCase())).size).toBe(briefs.length);
  });

  it('supplies a curated official handle for an exact named portfolio-company request', () => {
    const [requested] = buildGenerationBriefsV2({
      count: 1,
      requestedTopic: 'OpenAI',
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(requested.verifiedEntityMentions).toEqual([
      { entity: 'OpenAI', handle: 'openai', role: 'company', source: 'curated_registry' },
    ]);
  });

  it('supplies a curated handle when an idea introduces a company on a broad brief', () => {
    const writingPrompt = JSON.parse(buildTweetWritingPromptV2({
      id: 'idea-cursor-valuation',
      briefId: 'startups',
      topic: 'startups',
      publicMove: 'I would pay twice Cursor’s last private price within 12 months.',
      claim: 'Cursor could compound into the software creation layer.',
      tension: 'The current price still looks expensive.',
      implication: 'Coding-agent reliability changes the valuation frame.',
      counterargument: 'Reliability may plateau.',
    } as IdeaCandidate, brief('startups', 'startups'), [], []));

    expect(writingPrompt.verifiedEntityMentionPolicy).toMatchObject({
      available: [{ entity: 'Cursor', handle: '@cursor_ai', role: 'company' }],
    });
    expect(writingPrompt.verifiedEntityMentionPolicy.instruction).toContain('Never begin the post with @');
  });

  it('refuses an exact Natural promotion request before idea generation', () => {
    const requested = buildGenerationBriefsV2({
      count: 1,
      requestedTopic: 'Natural',
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(requested).toEqual([]);
  });

  it('refuses Cursor and non-priority portfolio promotion requests for Geoffrey', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const buildRequested = (requestedTopic: string) => buildGenerationBriefsV2({
      count: 1,
      requestedTopic,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(buildRequested('Cursor')).toEqual([]);
    expect(buildRequested('cursor startup valuation')).toEqual([]);
    expect(buildRequested('ElevenLabs')).toEqual([]);
    expect(buildRequested('OpenAI')).toHaveLength(1);
    expect(buildRequested('Cognition')).toHaveLength(1);
  });

  it('rejects Cursor when a fallback idea introduces it on a broad Geoffrey brief', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const startupBrief = brief('startup-brief', 'AI startups');
    const [idea] = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        startupBrief.id,
        'i would value @cursor_ai above every independent ai model startup within 12 months.',
      )],
      agentId: 'agent-1',
      runId: 'run-cursor-fallback',
      briefs: [startupBrief],
      voiceProfile: geoffreyVoiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-29T00:00:00.000Z',
    });

    expect(idea.status).toBe('rejected');
    expect(idea.rejectionCodes).toContain('company_amplification_blocked');
  });

  it('does not build or normalize sports ideas for the Geoffrey account', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['AI', 'startups', 'sports'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const sportsBrief = brief('sports', 'NBA defensive three seconds');
    const requested = buildGenerationBriefsV2({
      count: 1,
      requestedTopic: 'Caitlin Clark and the WNBA',
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['sports', 'AI'] } } as any,
      learnings: null,
      style: { autonomyMode: 'explore', trendMixTarget: 80, trendTolerance: 'adjacent', exploration: { underusedTopics: ['sports'] } } as any,
      trending: null,
      allTweets: [],
    });
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        sportsBrief.id,
        'the NBA should remove defensive three seconds because Wemby would make every possession weird.',
      )],
      agentId: 'agent-1',
      runId: 'run-sports-block',
      briefs: [sportsBrief],
      voiceProfile: geoffreyVoiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-19T00:00:00.000Z',
    });

    expect(requested).toEqual([]);
    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['account_topic_blocked']),
    });
    expect(JSON.parse(buildIdeaGenerationPromptV2(
      [brief('ai', 'AI startups')],
      geoffreyVoiceProfile,
    )).author.topics).not.toContain('sports');
  });

  it('reserves one constructive Anti Fund portfolio brief when the recent slate is empty', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['AI', 'startups', 'investing', 'consumer'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI', 'consumer'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 30, trendTolerance: 'moderate', exploration: { underusedTopics: ['consumer'] } } as any,
      trending: null,
      allTweets: [],
      seedRotationKey: 'portfolio-brief-test',
      now: new Date('2026-08-21T00:00:00.000Z'),
    });
    const portfolioBriefs = briefs.filter((entry) => Boolean(entry.portfolioCompanyContext));

    expect(portfolioBriefs).toHaveLength(1);
    expect(portfolioBriefs[0].portfolioCompanyContext).toMatchObject({
      policyVersion: ANTIFUND_PORTFOLIO_POLICY_VERSION,
      promotionTier: 'flagship',
      relationship: 'antifund_selected_investment',
      intent: 'constructive_conviction',
    });
    expect(portfolioBriefs[0].portfolioCompanyContext?.companyId).toMatch(/^(?:openai|cognition)$/);
    expect(portfolioBriefs[0].sourceBrief).toContain(ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION);
    if (portfolioBriefs[0].portfolioCompanyContext?.sportsAdjacent) {
      expect(portfolioBriefs[0].authorOpportunity).toContain('as a company');
    }
    expect(buildIdeaGenerationPromptV2([portfolioBriefs[0]], geoffreyVoiceProfile)).toContain('portfolioCompanyContext');
  });

  it('rejects a negative or fabricated portfolio-company idea before model judgment', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const portfolioBrief = buildGenerationBriefsV2({
      count: 1,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 20, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      seedRotationKey: 'portfolio-negative-test',
      now: new Date('2026-08-21T00:00:00.000Z'),
    }).find((entry) => entry.portfolioCompanyContext)!;
    const company = portfolioBrief.portfolioCompanyContext!.companyName;
    const [idea] = normalizeIdeaCandidatesV2({
      raw: [rawIdea(portfolioBrief.id, `we met the ${company} team and i think the company is overrated and cannot compete.`)],
      agentId: 'agent-1',
      runId: 'run-portfolio-negative',
      briefs: [portfolioBrief],
      voiceProfile: geoffreyVoiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-21T00:00:00.000Z',
    });

    expect(idea.status).toBe('rejected');
    expect(idea.rejectionCodes).toEqual(expect.arrayContaining([
      'portfolio_disparagement',
      'portfolio_invented_access',
    ]));
  });

  it('does not use Betr or Kings League as standing autonomous promotion subjects', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const autonomousCompanyIds = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      const portfolioBrief = buildGenerationBriefsV2({
        count: 1,
        stories: [],
        documents: [],
        voiceProfile: geoffreyVoiceProfile,
        analysis: { engagementPatterns: { topTopics: ['startups', 'consumer', 'media'] } } as any,
        learnings: null,
        style: { autonomyMode: 'balanced', trendMixTarget: 20, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
        trending: null,
        allTweets: [],
        seedRotationKey: `sports-portfolio-${index}`,
        now: new Date('2026-08-21T00:00:00.000Z'),
      }).find((entry) => entry.portfolioCompanyContext?.sportsAdjacent);
      if (portfolioBrief?.portfolioCompanyContext) {
        autonomousCompanyIds.add(portfolioBrief.portfolioCompanyContext.companyId);
      }
    }

    expect(autonomousCompanyIds).toEqual(new Set());
  });

  it('admits sports-adjacent portfolio stories only when the source itself is company news', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const makeSource = (id: string, title: string, excerpt: string): SourceDocument => ({
      schemaVersion: 2,
      id: `source-${id}`,
      agentId: 'agent-1',
      sourceType: 'x',
      canonicalUrl: `https://x.com/betr/status/${id}`,
      title,
      publisher: '@betr',
      publishedAt: '2026-08-21T00:00:00.000Z',
      fetchedAt: '2026-08-21T00:05:00.000Z',
      trustTier: 'primary',
      isPrimary: true,
      excerpt,
      contentHash: `hash-${id}`,
      entities: ['Betr'],
      claims: [{ id: `claim-${id}`, text: excerpt, kind: 'announcement', confidence: 0.95, entities: ['Betr'] }],
      topics: ['Betr'],
      query: null,
      metadata: {},
    });
    const makeStory = (id: string, title: string, summary: string): StoryCluster => ({
      schemaVersion: 2,
      id: `story-${id}`,
      agentId: 'agent-1',
      semanticKey: `betr:${id}`,
      title,
      summary,
      topic: 'sports media',
      entities: ['Betr'],
      sourceDocumentIds: [`source-${id}`],
      qualifiedClaimIds: [`claim-${id}`],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.92, evidenceStrength: 0.95, consequence: 0.8, freshness: 0.95, novelty: 0.8, networkMomentum: 0.8, total: 0.9 },
      firstSeenAt: '2026-08-21T00:00:00.000Z',
      lastSeenAt: '2026-08-21T00:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    });
    const build = (story: StoryCluster, source: SourceDocument) => buildGenerationBriefsV2({
      count: 2,
      stories: [story],
      documents: [source],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI', 'consumer'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 50, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      seedRotationKey: story.id,
      now: new Date('2026-08-21T01:00:00.000Z'),
    });

    const randomSportsSource = makeSource('event', "Betr odds on tonight's UFC matchup", 'Betr posted betting odds on tonight\'s UFC matchup.');
    const randomSportsStory = makeStory('event', randomSportsSource.title, randomSportsSource.excerpt);
    const businessSource = makeSource('business', 'Betr launches a media partnership', 'Betr launches a new media distribution partnership.');
    const businessStory = makeStory('business', businessSource.title, businessSource.excerpt);

    expect(build(randomSportsStory, randomSportsSource).some((brief) => brief.storyClusterId === randomSportsStory.id)).toBe(false);
    expect(build(businessStory, businessSource).find((brief) => brief.storyClusterId === businessStory.id)?.portfolioCompanyContext).toMatchObject({
      companyId: 'betr',
      intent: 'live_development',
    });
  });

  it('does not interpret repeated writing failures as loss of native topic taste', () => {
    expect(getOperatorTopicAttemptPenaltyV2('operator-written topic outcomes', 1)).toBe(0.03);
    expect(getOperatorTopicAttemptPenaltyV2('operator-written topic outcomes', 12)).toBe(0.18);
    expect(getOperatorTopicAttemptPenaltyV2('the active SOUL topic agenda', 12)).toBe(0.24);
    expect(getOperatorTopicAttemptPenaltyV2('mature account performance', 12)).toBe(0.36);
    expect(getOperatorTopicAttemptPenaltyV2('an underused operator topic', 12)).toBe(0.54);
  });

  it('releases failed network subjects quickly while retaining viable-premise cooldowns', () => {
    const signalId = 'network-modal-retry';
    const idea = {
      id: 'idea-modal-retry',
      briefId: stableResearchId('brief', 'operator-topic-signal', signalId),
      generationRunId: 'run-modal-retry',
      qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
      status: 'rejected',
      createdAt: '2026-08-14T04:30:00.000Z',
    } as IdeaCandidate;
    const now = new Date('2026-08-14T06:00:00.000Z');

    expect(getOperatorTopicSignalAttemptDecisionV2(signalId, [idea], now)).toMatchObject({
      eligible: true,
      disposition: 'failed_attempt_released',
      attemptedRunCount: 1,
      viableRunCount: 0,
    });
    expect(getOperatorTopicSignalAttemptDecisionV2(signalId, [{
      ...idea,
      status: 'selected',
    }], now)).toMatchObject({
      eligible: false,
      disposition: 'viable_attempt_cooldown',
      attemptedRunCount: 1,
      viableRunCount: 1,
    });
    expect(getOperatorTopicSignalAttemptDecisionV2(signalId, [{
      ...idea,
      status: 'quarantined',
    }], now)).toMatchObject({
      eligible: true,
      disposition: 'failed_attempt_released',
      viableRunCount: 0,
    });
    expect(getOperatorTopicSignalAttemptDecisionV2(signalId, [{
      ...idea,
      qualityPolicyVersion: 'publishing-v2-hard-gates-103',
    }], now)).toMatchObject({
      eligible: true,
      disposition: 'prior_policy_only',
      priorPolicyRunCount: 1,
    });
  });

  it('retains proven startup taste after failed runs instead of drifting to generic categories', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['ai', 'startup', 'vc', 'software', 'agents'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const manualTopicProfile = [
      ['startups', 32, 68],
      ['ai', 36, 55],
      ['culture', 24, 44],
      ['personal', 14, 33],
      ['humor', 5, 51],
      ['finance', 3, 57],
    ].map(([topic, sampleCount, avgEngagement]) => ({
      topic,
      angle: '',
      weight: 1,
      sampleCount,
      avgEngagement,
      topTweets: [],
    }));
    const recentRunCounts: Record<string, number> = {
      startups: 12,
      ai: 9,
      culture: 6,
      personal: 4,
      humor: 3,
      finance: 4,
      Engineering: 1,
    };
    const recentIdeas = Object.entries(recentRunCounts).flatMap(([topic, count]) => (
      Array.from({ length: count }, (_, index) => ({
        id: `idea-${topic}-${index}`,
        briefId: `brief-${topic}`,
        topic,
        generationRunId: `run-${topic}-${index}`,
        createdAt: '2026-08-14T05:30:00.000Z',
      }))
    )) as any;
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['Engineering', 'AI', 'startups'] } } as any,
      learnings: { manualTopicProfile } as any,
      style: { autonomyMode: 'explore', trendMixTarget: 35, trendTolerance: 'moderate', exploration: { underusedTopics: ['ai', 'startup', 'vc', 'agents'] } } as any,
      trending: null,
      allTweets: [],
      recentIdeas,
      seedRotationKey: 'production-shaped-topic-retention',
      now: new Date('2026-08-14T06:00:00.000Z'),
    });
    const topics = briefs.map((entry) => entry.topic);

    expect(topics).toContain('startups');
    expect(topics).not.toContain('Engineering');
    expect(topics.some((topic) => ['culture', 'personal', 'humor'].includes(topic))).toBe(true);
  });

  it('keeps a proven topic after its stored subject cues are exhausted', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['software', 'robotics', 'openai'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const exhaustedPremise = 'google should buy @cognition for $200b and make the founder ceo';
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['software', 'robotics', 'openai'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'startups',
          angle: 'operator startup outcomes',
          weight: 20,
          sampleCount: 32,
          avgEngagement: 68,
          topTweets: [{
            content: exhaustedPremise,
            topic: 'startups',
            source: 'manual',
            authorshipProvenance: 'operator_composed',
          }],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      recentIdeas: [{
        id: 'idea-exhausted-startup-cue',
        briefId: 'brief-startups',
        generationRunId: 'run-exhausted-startup-cue',
        topic: 'startups',
        publicMove: exhaustedPremise,
        claim: exhaustedPremise,
        tension: 'the acquisition call is the premise',
        implication: 'the premise has already been tried',
        createdAt: '2026-08-14T05:30:00.000Z',
      }] as any,
      seedRotationKey: 'preserve-topic-after-cue-exhaustion',
      now: new Date('2026-08-14T06:00:00.000Z'),
    });
    const startupBrief = briefs.find((entry) => entry.topic === 'startups');

    expect(startupBrief).toBeDefined();
    expect(startupBrief?.personalTopicSignals).toEqual([]);
    expect(startupBrief?.personalTopicSignalPremises).toEqual([]);
    expect(startupBrief?.creativeSeed?.id).toEqual(expect.any(String));
  });

  it('turns operator outcomes into structured subject signals without leaking prior prose', () => {
    const priorPost = 'one gigawatt of rubins puts 300k gpus and 80 pb of hbm behind the same power constraint';
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'health'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'AI',
          angle: 'A prior premise that must not be copied',
          weight: 20,
          sampleCount: 8,
          avgEngagement: 80,
          topTweets: [{ content: priorPost, topic: 'AI', source: 'timeline' }],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    const aiBrief = briefs.find((entry) => entry.topic.toLowerCase() === 'ai');
    expect(aiBrief?.personalTopicSignals).toEqual([
      expect.stringMatching(/gigawatt|rubins|300k|gpus|hbm/),
    ]);
    expect(aiBrief?.personalTopicSignalPremises).toEqual([priorPost]);
    const prompt = buildIdeaGenerationPromptV2([aiBrief!], voiceProfile);
    expect(prompt).not.toContain(priorPost);
    expect(prompt).not.toContain('A prior premise that must not be copied');
    expect(prompt).not.toContain('personalTopicSignals');
    expect(JSON.parse(prompt).briefs[0].personalTopicHistory).toEqual({
      informedTopicSelection: true,
      premiseSupplied: false,
      subjectCues: [expect.stringMatching(/gigawatt|rubins|300k|gpus|hbm/)],
      instruction: expect.stringContaining('Every proposition must use exactly one cue'),
    });
    expect(JSON.parse(prompt).requirements.personalTopicSignalContract).toContain('retain at least one');
    const writingPrompt = buildTweetWritingPromptV2({
      id: 'idea-ai-subject-cue',
      topic: 'AI',
      claim: 'I want to understand where the next compute bottleneck moves.',
      tension: 'The obvious bottleneck may not remain the binding one.',
      implication: 'The company formed around the next constraint could matter more.',
      counterargument: null,
    } as IdeaCandidate, aiBrief!, [], []);
    expect(writingPrompt).not.toContain(priorPost);
    expect(JSON.parse(writingPrompt).subjectContext.personalTopicHistory).toEqual({
      informedTopicSelection: true,
      premiseSupplied: false,
      subjectCues: [expect.stringMatching(/gigawatt|rubins|300k|gpus|hbm/)],
      instruction: expect.stringContaining('subject context only'),
    });
  });

  it('does not turn excluded media-dependent posts into exact Geoffrey subject cues', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI', 'markets'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'startups',
          angle: 'operator startup outcomes',
          weight: 20,
          sampleCount: 8,
          avgEngagement: 80,
          topTweets: [{
            content: 'SF rich: estate in woodside and padel on your home court',
            topic: 'startups',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
            voiceCorpusDispositions: ['excluded', 'topic_signal'],
          }, {
            content: 'google should buy @cognition for $200b and make @ScottWu46 ceo',
            topic: 'startups',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
            voiceCorpusDispositions: ['diction_anchor', 'topic_signal'],
          }],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    const startupBrief = briefs.find((entry) => entry.topic === 'startups');
    expect(startupBrief?.personalTopicSignals?.join(' ')).toContain('cognition');
    expect(startupBrief?.personalTopicSignals?.join(' ')).not.toContain('woodside');
    expect(startupBrief?.personalTopicSignalPremises).toHaveLength(1);
  });

  it('keeps excluded named topic signals out of exact subject reuse', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const excludedTopicSignal = 'we love @Etched and what @robertwachen is building. congrats to the whole team https://t.co/example';
    const generatedPost = '@OpenAI should own the whole software stack';
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'AI',
          angle: 'operator AI outcomes',
          weight: 20,
          sampleCount: 8,
          avgEngagement: 80,
          topTweets: [{
            content: excludedTopicSignal,
            topic: 'AI',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
            authorshipConfidence: 0.82,
            voiceCorpusDispositions: ['excluded', 'topic_signal'],
          }, {
            content: generatedPost,
            topic: 'AI',
            source: 'autopilot',
            authorshipProvenance: 'known_clawfable_generated',
            authorshipConfidence: 1,
            voiceCorpusDispositions: ['mechanics_only'],
          }],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    const aiBrief = briefs.find((entry) => entry.topic === 'AI');
    expect(aiBrief?.personalTopicSignals).toEqual([]);
    expect(aiBrief?.personalTopicSignalPremises).toEqual([]);
    const prompt = buildIdeaGenerationPromptV2([aiBrief!], geoffreyVoiceProfile);
    expect(prompt).not.toContain(excludedTopicSignal);
    expect(prompt).not.toContain(generatedPost);
    expect(JSON.parse(prompt).requirements.geoffreyNativeMoveContract).toContain('valuation');
    expect(JSON.parse(prompt).requirements.geoffreyNativeMoveContract).toContain('permissions');
  });

  it('uses structured subject cues to keep a broad personal lane on-topic', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['personal', 'AI', 'startups', 'culture'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['personal', 'AI', 'startups', 'culture'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'personal',
          angle: 'personal experiments',
          weight: 20,
          sampleCount: 8,
          avgEngagement: 80,
          topTweets: [{
            content: 'ketone is still interesting to me',
            topic: 'personal',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
            authorshipConfidence: 0.9,
            voiceCorpusDispositions: ['diction_anchor', 'topic_signal'],
          }],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    const personalBrief = briefs.find((entry) => entry.topic === 'personal');
    expect(personalBrief?.personalTopicSignals?.join(' ')).toContain('ketone');
    expect(personalBrief?.creativeSeed?.kind).toBe('health');
  });

  it('does not reuse a sourced story subject through a durable personal cue', () => {
    expect(hasCrossBriefSubjectCollisionV2('cognition scottwu46', 'Cognition valuation talks')).toBe(true);
    expect(hasCrossBriefSubjectCollisionV2('tonyrobbins storytelling', 'Tony Robbins crowd intervention')).toBe(true);
    expect(hasCrossBriefSubjectCollisionV2('tonyrobbins storytelling', 'Cognition valuation talks')).toBe(false);
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['startups', 'AI', 'markets', 'culture'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const source: SourceDocument = {
      schemaVersion: 2,
      id: 'source-cognition-valuation',
      agentId: '13',
      sourceType: 'official',
      canonicalUrl: 'https://example.com/cognition',
      title: 'Cognition valuation talks',
      publisher: 'Example',
      publishedAt: '2026-08-14T05:00:00.000Z',
      fetchedAt: '2026-08-14T05:05:00.000Z',
      trustTier: 'primary',
      isPrimary: true,
      excerpt: 'Cognition is discussing a new financing at a $40 billion valuation.',
      contentHash: 'cognition-source',
      entities: ['Cognition'],
      claims: [{
        id: 'claim-cognition-valuation',
        text: 'Cognition is discussing a new financing at a $40 billion valuation.',
        kind: 'announcement',
        confidence: 0.92,
        entities: ['Cognition'],
      }],
      topics: ['cognition'],
      query: null,
      metadata: {},
    };
    const story: StoryCluster = {
      schemaVersion: 2,
      id: 'story-cognition-valuation',
      agentId: '13',
      semanticKey: 'cognition:valuation:talks',
      title: 'Cognition valuation talks',
      summary: 'Cognition is discussing a new financing at a $40 billion valuation.',
      topic: 'cognition',
      entities: ['Cognition'],
      sourceDocumentIds: [source.id],
      qualifiedClaimIds: ['claim-cognition-valuation'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: {
        identityFit: 0.92,
        evidenceStrength: 0.92,
        consequence: 0.82,
        freshness: 0.9,
        novelty: 0.8,
        networkMomentum: 0.7,
        total: 0.88,
      },
      firstSeenAt: '2026-08-14T05:00:00.000Z',
      lastSeenAt: '2026-08-14T05:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    };
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [story],
      documents: [source],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI', 'markets'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'startups',
          angle: 'operator startup outcomes',
          weight: 20,
          sampleCount: 8,
          avgEngagement: 80,
          topTweets: [{
            content: 'google should buy @cognition for $200b and make @ScottWu46 ceo',
            topic: 'startups',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
            voiceCorpusDispositions: ['diction_anchor', 'topic_signal'],
          }, {
            content: '@TonyRobbins is the best bullshitter in the game',
            topic: 'startups',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
            voiceCorpusDispositions: ['diction_anchor', 'topic_signal'],
          }],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(briefs.some((entry) => entry.storyClusterId === story.id)).toBe(true);
    const startupBrief = briefs.find((entry) => entry.topic === 'startups');
    expect(startupBrief?.personalTopicSignals?.join(' ')).toContain('tonyrobbins');
    expect(startupBrief?.personalTopicSignals?.join(' ')).not.toContain('cognition');
    expect(startupBrief?.personalTopicSignalPremises?.join(' ')).not.toContain('@cognition');
  });

  it('cools exact native subject cues after a recent failed generation attempt', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      topics: ['startups', 'AI', 'software', 'markets', 'culture', 'personal'],
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const nativeTweet = (content: string, topic: string) => ({
      content,
      topic,
      source: 'timeline',
      authorshipProvenance: 'timeline_unmatched',
      voiceCorpusDispositions: ['diction_anchor', 'topic_signal'],
    });
    const recentIdea = (id: string, topic: string, publicMove: string) => ({
      id,
      briefId: `brief-${topic}`,
      topic,
      publicMove,
      claim: publicMove,
      tension: 'The prior run could not turn this subject into a native post.',
      implication: 'The exact subject should rotate before another writer call.',
      generationRunId: `run-${id}`,
      createdAt: '2026-08-14T05:30:00.000Z',
    });
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI', 'software', 'markets', 'culture'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'startups',
          angle: '',
          weight: 20,
          sampleCount: 12,
          avgEngagement: 80,
          topTweets: [nativeTweet('google should buy @cognition for $200b and make @ScottWu46 ceo', 'startups')],
        }, {
          topic: 'AI',
          angle: '',
          weight: 20,
          sampleCount: 12,
          avgEngagement: 75,
          topTweets: [nativeTweet('@TonyRobbins is the best bullshitter in the game', 'AI')],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      recentIdeas: [
        recentIdea('cognition', 'startups', 'Cognition should stay founder-shaped.'),
        recentIdea('tony', 'AI', 'Tony Robbins needs an AI skeptic in the crowd.'),
      ] as any,
      seedRotationKey: 'native-subject-cooldown',
      now: new Date('2026-08-14T06:00:00.000Z'),
    });

    const activeSignals = briefs.flatMap((entry) => entry.personalTopicSignals || []).join(' ');
    expect(activeSignals).not.toMatch(/cognition|tonyrobbins/i);
  });

  it('rotates away from operator subjects already attempted in recent generation runs', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const topic = (id: number, networkTopicId: string, category: string, entities: string[]) => ({
      id,
      networkTopicId,
      headline: category,
      source: '@network',
      relevanceScore: 90,
      category,
      timestamp: '2026-08-14T05:00:00.000Z',
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'low' as const,
      semanticDomain: 'startups_markets' as const,
      entities,
      isPrimarySource: false,
      topTweet: { id: `${networkTopicId}-post`, text: category, likes: 100, author: 'network' },
    });
    const trending = [
      topic(951, 'network-opendoor', 'Opendoor startup strategy', ['Opendoor', 'Justin Dross']),
      topic(952, 'network-modal', 'Modal startup financing', ['Modal', 'Databricks']),
      topic(953, 'network-cognition', 'Cognition product strategy', ['Cognition AI', 'Devin']),
    ];
    const common = {
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets', 'culture'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending,
      allTweets: [],
      seedRotationKey: 'same-run-seed',
      now: new Date('2026-08-14T06:00:00.000Z'),
    };
    const first = buildGenerationBriefsV2({ ...common, recentIdeas: [] });
    const firstSignal = first.find((entry) => entry.trendTopicId?.startsWith('network-'))!;
    const recentIdeas = [0, 1, 2].map((index) => ({
      id: `idea-recent-${index}`,
      briefId: firstSignal.id,
      topic: firstSignal.topic,
      generationRunId: 'generation-recent',
      createdAt: '2026-08-14T05:30:00.000Z',
    })) as any;
    const newerNoise = Array.from({ length: 120 }, (_, index) => ({
      id: `idea-noise-${index}`,
      briefId: `brief-noise-${index % 4}`,
      topic: `noise ${index % 4}`,
      generationRunId: `generation-noise-${Math.floor(index / 12)}`,
      createdAt: '2026-08-14T05:45:00.000Z',
    })) as any;
    const second = buildGenerationBriefsV2({ ...common, recentIdeas: [...newerNoise, ...recentIdeas] });
    const secondSignal = second.find((entry) => entry.trendTopicId?.startsWith('network-'))!;
    const afterPolicyUpgrade = buildGenerationBriefsV2({
      ...common,
      recentIdeas: recentIdeas.map((idea) => ({
        ...idea,
        qualityPolicyVersion: 'publishing-v2-hard-gates-103',
      })),
    });
    const upgradedSignal = afterPolicyUpgrade.find((entry) => entry.trendTopicId?.startsWith('network-'))!;

    expect(secondSignal.trendTopicId).not.toBe(firstSignal.trendTopicId);
    expect(upgradedSignal.trendTopicId).toBe(firstSignal.trendTopicId);
  });

  it('blocks a personal topic signal from inverting the native premise that produced it', () => {
    const operatorBrief = {
      ...brief('operator', 'culture'),
      personalTopicSignals: ['estate:woodside:host:dinner:parties:poker'],
      personalTopicSignalPremises: [
        'SF rich: estate in woodside, host dinner parties and poker with ai founders',
      ],
    };
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'A CEO treating a Woodside dinner invitation as more valuable than a stranger paying is optimizing for approval.',
      )],
      agentId: 'agent-1',
      runId: 'run-personal-premise-reskin',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['voice_anchor_semantic_reskin']),
    });
    expect(buildIdeaGenerationPromptV2([operatorBrief], voiceProfile)).not.toContain('SF rich');

    const adjacentIdeas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'OpenAI should ship an agent that can terminate paid SaaS subscriptions.',
      )],
      agentId: 'agent-1',
      runId: 'run-personal-premise-adjacent',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });
    expect(adjacentIdeas[0].rejectionCodes).not.toContain('voice_anchor_semantic_reskin');
    expect(adjacentIdeas[0].rejectionCodes).toContain('personal_topic_subject_dropped');
  });

  it('requires a historical topic cue object without requiring the old premise', () => {
    const signals = [
      'dinner:estate:host:partie:poker:rich:woodside',
      'antifund:comma:jakepaul:journey:march',
    ];

    expect(retainsPersonalTopicSubjectV2(
      'woodside is a better startup recruiting surface than another founder conference',
      signals,
    )).toBe(true);
    expect(retainsPersonalTopicSubjectV2(
      'the next great robotics company should obsess over actuator cost',
      signals,
    )).toBe(false);
    expect(retainsPersonalTopicSubjectV2(
      'QQQ is where an AI thesis goes to become an interest-rate bet',
      ['leopoldasch:salp:leverage', 'qqq'],
    )).toBe(true);
    expect(retainsPersonalTopicSubjectV2('any subject is valid', ['capital:market'])).toBe(true);
  });

  it('flags a bounded share of under-tested-arm drafts as exploration holdouts', () => {
    const arm = (name: string, overrides: Record<string, unknown> = {}) => ({
      arm: name,
      family: 'format',
      pulls: 10,
      localPulls: 10,
      globalPulls: 0,
      priorPulls: 2,
      successes: 6,
      failures: 1,
      meanReward: 0.6,
      globalMeanReward: 0.5,
      explorationBonus: 0.02,
      uncertainty: 0.05,
      alpha: 5,
      beta: 2,
      ucbScore: 0.6,
      thompsonScore: 0.6,
      localShare: 1,
      coldStart: false,
      ...overrides,
    }) as any;
    const policy = {
      formatArms: [arm('hot_take'), arm('long_form', { localPulls: 0, coldStart: true })],
      hookArms: [arm('question', { family: 'hook' })],
    } as any;

    // Proven arms never become holdouts.
    for (let index = 0; index < 30; index++) {
      expect(shouldFlagExplorationHoldoutV2(`draft-${index}`, 'hot_take', 'question', policy)).toBe(false);
    }
    // Under-tested arms are flagged for a deterministic subset of draft ids.
    const flagged = Array.from({ length: 30 }, (_, index) =>
      shouldFlagExplorationHoldoutV2(`draft-${index}`, 'long_form', 'question', policy));
    const flaggedCount = flagged.filter(Boolean).length;
    expect(flaggedCount).toBeGreaterThan(0);
    expect(flaggedCount).toBeLessThan(30);
    // Deterministic: same id, same answer.
    expect(shouldFlagExplorationHoldoutV2('draft-0', 'long_form', 'question', policy))
      .toBe(flagged[0]);
    // No policy, no experiments.
    expect(shouldFlagExplorationHoldoutV2('draft-1', 'long_form', 'question', null)).toBe(false);
  });

  it('does not declare two takes the same premise just for sharing everyday startup vocabulary', () => {
    // Shares team_headcount + benchmark_shipping buckets ("team"/"hire",
    // "ship"/"build") but the premises are unrelated.
    expect(isOperatorPremiseReskinV2(
      'a tiny team shipped a production agent in six weeks',
      ['stop hiring engineers to chase model quality leaderboards'],
    )).toBe(false);
    // Two precise buckets (leverage + timing) still reject as a reskin.
    expect(isOperatorPremiseReskinV2(
      'the margin agreement killed that trade before the market ever moved',
      ['he scaled too fast with leverage and got liquidated by timing'],
    )).toBe(true);
  });

  it('allows a new premise on the same native subject while preserving rare-premise blocks', () => {
    const cognitionHistory = 'i had a call to invest in @cognition while @ScottWu46 visited a founder\'s parents';
    const salpHistory = 'SALP @leopoldasch scaled too fast with leverage. i am long Leopold.';
    const investorUpdateHistory = 'investor updates are easier when customers already give you context';

    expect(isOperatorPremiseReskinV2(
      'Cognition should become the default software factory.',
      [cognitionHistory],
      ['cognition', 'Cognition funding', 'cognition:scottwu46'],
    )).toBe(false);
    expect(isOperatorPremiseReskinV2(
      'SALP customers should fund the next scale-up before Leopold sells more equity.',
      [salpHistory],
      ['finance', 'salp:leopoldasch:leopold'],
    )).toBe(false);
    expect(isOperatorPremiseReskinV2(
      'Trajectory should make switching open-source models easier without becoming disposable.',
      [investorUpdateHistory],
      ['Trajectory', 'open-source models'],
    )).toBe(false);
    expect(isOperatorPremiseReskinV2(
      'Google should hand Scott Wu control of a standalone AI software unit.',
      ['google should buy @cognition and make @ScottWu46 ceo'],
      ['google:cognition:scottwu46'],
    )).toBe(true);
  });

  it('does not turn a historical subject cue into an unsupported launch event', () => {
    const operatorBrief = {
      ...brief('operator', 'startups'),
      personalTopicSignals: ['jakepaul:antifund'],
      personalTopicSignalPremises: ['day 1 with @jakepaul on our journey with @antifund'],
    };
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'Jake Paul launching AntiFund is less interesting than whether AntiFund can tell him no.',
      )],
      agentId: 'agent-1',
      runId: 'run-historical-launch-event',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
    });
  });

  it('keeps concrete native subjects and drops abstract token debris from topic cues', () => {
    const startupCues = buildPersonalTopicSubjectCuesV2('startups', [{
      content: 'SF rich:\n- estate in woodside\n- host dinner parties and poker\n- play padel on your home court',
      topic: 'startups',
    }]);
    const abstractCues = buildPersonalTopicSubjectCuesV2('culture', [{
      content: "don't pray on other people's downfall. it simply reveals your own insecurity",
      topic: 'culture',
    }]);
    const humorCues = buildPersonalTopicSubjectCuesV2('humor', [{
      content: "what is your profession? i'm an aura farmer.",
      topic: 'humor',
    }]);
    const entityCues = buildPersonalTopicSubjectCuesV2('humor', [{
      content: 'only venues that could possibly beat White House: Roman Colosseum, Moon, Mars',
      topic: 'humor',
    }]);
    const mentionCues = buildPersonalTopicSubjectCuesV2('ai', [{
      content: '@TonyRobbins cannot bullshit AI twitter https://t.co/9uHK7dM98j',
      topic: 'ai',
    }]);

    expect(startupCues).toHaveLength(1);
    expect(startupCues[0]).toContain('woodside');
    expect(startupCues[0]).not.toContain('rich');
    expect(abstractCues).toEqual([]);
    expect(humorCues).toEqual([expect.stringMatching(/aura.*farmer|farmer.*aura/)]);
    expect(entityCues).toEqual([expect.stringContaining('white')]);
    expect(entityCues[0]).toContain('colosseum');
    expect(mentionCues[0].split(':')).toContain('tonyrobbins');
    expect(mentionCues[0]).not.toContain('9uhk7dm98j');
  });

  it('normalizes a spaced name against its native handle when checking premise reuse', () => {
    const operatorBrief = {
      ...brief('operator', 'ai'),
      personalTopicSignals: ['google:buy:cognition:200b:scottwu46'],
      personalTopicSignalPremises: [
        'google should buy @cognition for $200b and make @ScottWu46 ceo',
      ],
    };
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'Google should hand Scott Wu control of a standalone AI software unit with its own equity.',
      )],
      agentId: 'agent-1',
      runId: 'run-personal-premise-handle-alias',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).toContain('voice_anchor_semantic_reskin');
  });

  it('uses an operator-engaged network post as a subject cue without exposing its prose as evidence', () => {
    const headline = 'OpenAI launches a consumer agent with a secret checkout workflow';
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: {
        ...voiceProfile,
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
      },
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: [{
        id: 991,
        networkTopicId: 'network-openai-consumer-agent',
        headline,
        source: '@builder',
        relevanceScore: 92,
        category: 'OpenAI consumer agent launch',
        timestamp: new Date().toISOString(),
        tweetCount: 2,
        sourceType: 'x',
        sourceCount: 2,
        discoveryMethod: 'followed_network',
        networkMomentumScore: 0.86,
        operatorEngagementScore: 0.94,
        topicConfidence: 0.9,
        topicUncertainty: 'low',
        semanticDomain: 'ai_compute',
        entities: ['OpenAI'],
        entityRoles: [{ name: 'OpenAI', role: 'company', xHandle: 'openai' }],
        isPrimarySource: false,
        topTweet: { id: 'network-post-1', text: headline, likes: 900, author: 'builder' },
      } as any],
      allTweets: [],
    });

    const signal = briefs.find((entry) => entry.trendTopicId === 'network-openai-consumer-agent');
    expect(signal).toMatchObject({
      topic: 'OpenAI consumer agent',
      evidenceMode: 'operator_opinion',
      evidence: [],
      sourceDocumentIds: [],
      creativeSeed: null,
    });
    expect(JSON.stringify(signal)).not.toContain('secret checkout workflow');
    expect(signal?.sourceBrief).toContain('Subject cue only');
    expect(signal?.authorOpportunity).toContain('Roles do not prove any relationship');
    expect(signal?.operatorTopicContext).toEqual({
      entityRoles: [{ name: 'OpenAI', role: 'company', xHandle: 'openai' }],
      strippedEventTerms: ['launch'],
      relationshipStatus: 'unverified',
    });
    expect(signal?.verifiedEntityMentions).toEqual([
      { entity: 'OpenAI', handle: 'openai', role: 'company', source: 'official_x_author' },
    ]);
    const writingPrompt = JSON.parse(buildTweetWritingPromptV2({
      id: 'idea-openai-mention',
      publicMove: 'OpenAI will make consumer agents the default interface.',
      claim: 'I expect OpenAI to make consumer agents the default interface.',
      tension: 'The current interface still feels early.',
      implication: 'Consumer behavior changes.',
      counterargument: 'Adoption could take longer.',
      topic: signal!.topic,
    } as IdeaCandidate, signal!, [], []));
    expect(writingPrompt.verifiedEntityMentionPolicy).toMatchObject({
      available: [{ entity: 'OpenAI', handle: '@openai', role: 'company' }],
    });
    expect(writingPrompt.verifiedEntityMentionPolicy.instruction).toContain('Never begin the post with @');
  });

  it('treats a named IPO timing comparison as a complete direct-prediction brief', () => {
    const input = {
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: {
        ...voiceProfile,
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
      },
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: [{
        id: 992,
        networkTopicId: 'network-modal-databricks-ipo',
        headline: 'A network post asks which company will IPO first.',
        source: '@builder',
        relevanceScore: 92,
        category: 'Modal Databricks IPO timing',
        timestamp: new Date().toISOString(),
        tweetCount: 1,
        sourceType: 'x',
        sourceCount: 1,
        discoveryMethod: 'followed_network',
        networkMomentumScore: 0.86,
        operatorEngagementScore: 0.94,
        topicConfidence: 0.9,
        topicUncertainty: 'low',
        semanticDomain: 'finance_investing',
        entities: ['Polymarket', 'Modal', 'Databricks'],
        entityRoles: [
          { name: 'Polymarket', role: 'company' },
          { name: 'Modal', role: 'company' },
          { name: 'Databricks', role: 'company' },
        ],
        isPrimarySource: false,
        topTweet: { id: 'network-post-ipo', text: 'raw network prose', likes: 900, author: 'builder' },
      } as any],
      allTweets: [],
    };
    const briefs = buildGenerationBriefsV2(input as any);

    const timingBrief = briefs.find((entry) => entry.trendTopicId === 'network-modal-databricks-ipo')!;
    expect(timingBrief.authorOpportunity).toContain('say who happens first');
    expect(timingBrief.authorOpportunity).toContain('One compressed line can be complete');
    expect(timingBrief.authorOpportunity).toContain('Do not invent');
    expect(normalizeDirectComparisonPublicMoveV2(
      'Databricks rings the bell before Modal even files. Modal is still in the phase where staying private compounds faster.',
      timingBrief,
    )).toBe('Databricks rings the bell before Modal even files.');

    const writingPrompt = JSON.parse(buildTweetWritingPromptV2({
      id: 'idea-ipo-timing',
      publicMove: 'i think Modal IPOs before Databricks.',
      claim: 'My prediction is that Modal goes public first.',
      tension: 'I could be wrong.',
      implication: 'The comparison is the point.',
      counterargument: 'Databricks may move first.',
      topic: timingBrief.topic,
    } as IdeaCandidate, timingBrief, [], []));
    expect(writingPrompt.subjectContext.briefIntent).toBe(timingBrief.authorOpportunity);
    expect(writingPrompt.subjectContext.operatorTopicContext.entityRoles).toEqual([
      { name: 'Modal', role: 'company' },
      { name: 'Databricks', role: 'company' },
    ]);

    const afterQueueCommit = buildGenerationBriefsV2({
      ...input,
      allTweets: [{
        id: 'queued-ipo-prediction',
        status: 'queued',
        topic: 'Modal Databricks IPO timing',
        content: 'i’m picking Databricks to IPO before Modal.',
        createdAt: new Date().toISOString(),
      } as Tweet],
    } as any);
    expect(afterQueueCommit.some((entry) => entry.trendTopicId === 'network-modal-databricks-ipo')).toBe(false);
  });

  it('blocks operator-topic role swaps and stripped event premises before judgment', () => {
    const roleContext = {
      entityRoles: [
        { name: 'Trajectory', role: 'company' as const },
        { name: 'Sequoia', role: 'investor' as const },
        { name: 'open source models', role: 'technology' as const },
      ],
      strippedEventTerms: [],
      relationshipStatus: 'unverified' as const,
    };
    expect(getOperatorTopicConstraintIssuesV2(
      'Trajectory gets interesting if model forks are tied to Sequoia, not just hosted there.',
      roleContext,
    )).toContain('operator_entity_role_violation');
    expect(getOperatorTopicConstraintIssuesV2(
      'Sequoia can get used a lot without anyone caring about Trajectory.',
      roleContext,
    )).toContain('operator_entity_role_violation');
    expect(getOperatorTopicConstraintIssuesV2(
      'Sequoia should back more open source model companies.',
      roleContext,
    )).not.toContain('operator_entity_role_violation');

    const eventContext = { ...roleContext, strippedEventTerms: ['funding'] };
    expect(getOperatorTopicConstraintIssuesV2(
      'Trajectory raised funding from Sequoia for open source models.',
      eventContext,
    )).toContain('operator_stripped_event_reintroduced');

    const operatorBrief = {
      ...brief('operator-role', 'Trajectory Sequoia open source models'),
      operatorTopicContext: roleContext,
    };
    const [idea] = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator-role',
        'Trajectory gets interesting if model forks are tied to Sequoia, not just hosted there.',
      )],
      agentId: 'agent-1',
      runId: 'run-operator-role',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-14T12:00:00.000Z',
    });
    expect(idea.rejectionCodes).toContain('operator_entity_role_violation');
  });

  it('allocates two of four Geoffrey briefs to fresh operator-engaged subjects', () => {
    const networkTopic = (
      id: number,
      networkTopicId: string,
      category: string,
      semanticDomain: 'ai_compute' | 'startups_markets' | 'finance_investing',
      entities: string[],
    ) => ({
      id,
      networkTopicId,
      headline: `${category} source headline that must stay out of prompts`,
      source: '@network',
      relevanceScore: 90,
      category,
      timestamp: new Date().toISOString(),
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'low' as const,
      semanticDomain,
      entities,
      isPrimarySource: false,
      topTweet: { id: `${networkTopicId}-post`, text: 'raw network prose', likes: 100, author: 'network' },
    });
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: {
        ...voiceProfile,
        summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
      },
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: [
        networkTopic(981, 'network-cognition-interest', 'Cognition product strategy', 'ai_compute', ['Cognition AI', 'Devin']),
        networkTopic(982, 'network-opendoor-interest', 'Opendoor startup strategy', 'startups_markets', ['Opendoor', 'Justin Dross']),
        networkTopic(983, 'network-polymarket-interest', 'Polymarket market structure', 'finance_investing', ['Polymarket', 'Modal']),
      ],
      allTweets: [],
    });
    const signalBriefs = briefs.filter((entry) => entry.trendTopicId?.startsWith('network-'));

    expect(signalBriefs).toHaveLength(2);
    expect(signalBriefs.every((entry) => (
      entry.evidenceMode === 'operator_opinion'
      && entry.evidence.length === 0
      && entry.sourceDocumentIds.length === 0
      && entry.creativeSeed === null
    ))).toBe(true);
    expect(signalBriefs.map((entry) => entry.topic)).toEqual(expect.arrayContaining([
      'Cognition product strategy',
      'Opendoor startup strategy',
    ]));
  });

  it('does not reintroduce a blocked premise through an operator-engaged subject cue', () => {
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: {
        ...voiceProfile,
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
      },
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: [{
        id: 993,
        networkTopicId: 'network-openai-blocked',
        headline: 'OpenAI consumer agent discussion',
        source: '@builder',
        relevanceScore: 92,
        category: 'OpenAI consumer agent',
        timestamp: new Date().toISOString(),
        tweetCount: 1,
        sourceType: 'x',
        sourceCount: 1,
        discoveryMethod: 'followed_network',
        networkMomentumScore: 0.86,
        operatorEngagementScore: 0.94,
        topicConfidence: 0.9,
        topicUncertainty: 'low',
        semanticDomain: 'ai_compute',
        entities: ['OpenAI'],
        isPrimarySource: false,
        topTweet: { id: 'network-post-blocked', text: 'raw source prose', likes: 900, author: 'builder' },
      } as any],
      allTweets: [],
      blocks: [{
        schemaVersion: 2,
        id: 'blocked-openai-subject',
        agentId: 'agent-1',
        scope: 'topic',
        semanticKey: 'openai:ai:compute',
        topic: 'OpenAI in ai compute',
        storyClusterId: null,
        ideaId: null,
        reasonCode: 'bad_premise',
        reason: 'Do not revisit this subject.',
        permanent: true,
        blockedUntil: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    });

    expect(briefs.some((entry) => entry.trendTopicId === 'network-openai-blocked')).toBe(false);
  });

  it('does not launder a consumed sourced story back into a source-free network brief', () => {
    const headline = 'Brad Lightcap said he is leaving OpenAI to start something new.';
    const story = {
      schemaVersion: 2,
      id: 'story-lightcap-source-backed',
      agentId: 'agent-1',
      semanticKey: 'brad:lightcap:openai:leaving:start:new',
      title: headline,
      summary: headline,
      topic: 'OpenAI executive departure',
      entities: ['Brad Lightcap', 'OpenAI'],
      sourceDocumentIds: ['source-lightcap'],
      qualifiedClaimIds: ['claim-lightcap'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.7, freshness: 0.9, novelty: 0.8, networkMomentum: 0.8, total: 0.9 },
      firstSeenAt: '2026-08-12T00:00:00.000Z',
      lastSeenAt: '2026-08-12T01:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [story],
      documents: [],
      voiceProfile: {
        ...voiceProfile,
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
      },
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: [{
        id: 992,
        networkTopicId: 'network-brad-lightcap',
        headline,
        source: '@bradlightcap',
        relevanceScore: 95,
        category: 'OpenAI executive departure',
        timestamp: new Date().toISOString(),
        tweetCount: 1,
        sourceType: 'x',
        sourceCount: 1,
        discoveryMethod: 'followed_network',
        networkMomentumScore: 0.86,
        operatorEngagementScore: 0.94,
        topicConfidence: 0.94,
        topicUncertainty: 'low',
        semanticDomain: 'ai_compute',
        entities: ['Brad Lightcap', 'OpenAI'],
        isPrimarySource: true,
        topTweet: { id: 'network-post-lightcap', text: headline, likes: 900, author: 'bradlightcap' },
      } as any],
      allTweets: [{
        id: 'posted-lightcap',
        status: 'posted',
        storyClusterId: story.id,
        content: 'Prior post about this story.',
        createdAt: '2026-08-12T02:00:00.000Z',
      } as Tweet],
      now: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(briefs.some((entry) => entry.storyClusterId === story.id)).toBe(false);
    expect(briefs.some((entry) => entry.trendTopicId === 'network-brad-lightcap')).toBe(false);
  });

  it('keeps most refill briefs in the native operator lane', () => {
    const stories = ['AI chips', 'robotics', 'energy', 'biotech'].map((topic, index) => ({
      schemaVersion: 2,
      id: `story-mix-${index}`,
      agentId: 'agent-1',
      semanticKey: `${topic.replace(/\s+/g, ':')}:company:${index}`.toLowerCase(),
      title: `${topic} company changes its operating model`,
      summary: `A sourced ${topic} development with a concrete operating consequence.`,
      topic,
      entities: [`Company ${index}`],
      sourceDocumentIds: [`source-mix-${index}`],
      qualifiedClaimIds: [`claim-mix-${index}`],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0.5, total: 0.9 - index * 0.01 },
      firstSeenAt: '2026-08-12T00:00:00.000Z',
      lastSeenAt: '2026-08-12T01:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster));
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories,
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'markets'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: ['consumer AI'] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(briefs).toHaveLength(4);
    expect(briefs.filter((entry) => entry.evidenceMode === 'verified_source')).toHaveLength(1);
    expect(briefs.filter((entry) => entry.evidenceMode === 'operator_opinion')).toHaveLength(3);
    expect(briefs.find((entry) => entry.evidenceMode === 'verified_source')?.authorOpportunity).toContain('plain high-context reaction can be complete');
    const ideaPrompt = JSON.parse(buildIdeaGenerationPromptV2(briefs, voiceProfile));
    expect(ideaPrompt.requirements.verifiedSourceReactionContract).toContain('Do not invent a downstream business model');
  });

  it('keeps at least 70% of refill briefs in core topics without excluding recent proven lanes', () => {
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'culture', 'startups', 'personal', 'humor', 'sports'] } } as any,
      learnings: {
        manualTopicProfile: [
          { topic: 'culture', angle: 'status behavior', weight: 20, sampleCount: 8, avgEngagement: 60, topTweets: [] },
          { topic: 'personal', angle: 'personal experiments', weight: 18, sampleCount: 6, avgEngagement: 55, topTweets: [] },
          { topic: 'humor', angle: 'compressed joke', weight: 16, sampleCount: 5, avgEngagement: 50, topTweets: [] },
          { topic: 'sports', angle: 'competition', weight: 14, sampleCount: 4, avgEngagement: 45, topTweets: [] },
          { topic: 'AI', angle: 'model competition', weight: 12, sampleCount: 10, avgEngagement: 40, topTweets: [] },
          { topic: 'startups', angle: 'company building', weight: 10, sampleCount: 10, avgEngagement: 38, topTweets: [] },
        ],
      } as any,
      style: { autonomyMode: 'explore', trendMixTarget: 35, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [
        { id: 'recent-ai', status: 'posted', topic: 'AI', content: 'recent ai post', createdAt: '2026-08-12T03:00:00.000Z' },
        { id: 'recent-startup', status: 'posted', topic: 'startups', content: 'recent startup post', createdAt: '2026-08-12T02:00:00.000Z' },
      ] as Tweet[],
    });

    expect(briefs).toHaveLength(4);
    const coreBriefs = briefs.filter((entry) => [
      'ai_compute',
      'startups_markets',
      'finance_investing',
      'general_technology',
    ].includes(classifyGeoffreyTopicDomain(`${entry.topic} ${entry.title}`)));
    expect(coreBriefs).toHaveLength(3);
    expect(briefs.map((entry) => entry.topic)).toEqual(expect.arrayContaining(['AI', 'startups']));
  });

  it('keeps Geoffrey deep-technical subjects in a minority lane across V2 briefs', () => {
    const briefs = buildGenerationBriefsV2({
      count: 5,
      stories: [],
      documents: [],
      voiceProfile: {
        ...voiceProfile,
        topics: ['AI', 'startups', 'investing', 'culture', 'sports', 'health', 'developer tools', 'fusion', 'robotics'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
      },
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'culture', 'sports'] } } as any,
      learnings: {
        manualTopicProfile: [
          { topic: 'AI', angle: 'products and labs', weight: 10, sampleCount: 10, avgEngagement: 100, topTweets: [] },
          { topic: 'startups', angle: 'founders and growth', weight: 9, sampleCount: 9, avgEngagement: 90, topTweets: [] },
          { topic: 'investing', angle: 'capital and conviction', weight: 8, sampleCount: 8, avgEngagement: 80, topTweets: [] },
          { topic: 'fusion tritium breeding', angle: 'first-wall survival', weight: 7, sampleCount: 7, avgEngagement: 70, topTweets: [] },
          { topic: 'humanoid actuator duty cycles', angle: 'field service intervals', weight: 6, sampleCount: 6, avgEngagement: 60, topTweets: [] },
          { topic: 'rare earth magnet sintering yield', angle: 'manufacturing constraints', weight: 5, sampleCount: 5, avgEngagement: 50, topTweets: [] },
          { topic: 'culture', angle: 'status and ambition', weight: 4, sampleCount: 4, avgEngagement: 40, topTweets: [] },
          { topic: 'sports', angle: 'competition', weight: 3, sampleCount: 3, avgEngagement: 30, topTweets: [] },
          { topic: 'health', angle: 'personal experiments', weight: 2, sampleCount: 2, avgEngagement: 20, topTweets: [] },
          { topic: 'developer tools', angle: 'software builders', weight: 1, sampleCount: 1, avgEngagement: 10, topTweets: [] },
        ],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });

    const subjects = briefs.map((entry) => [
      entry.topic,
      entry.title,
      entry.creativeSeed?.object,
      entry.creativeSeed?.hiddenConstraint,
    ].filter(Boolean).join(' '));
    expect(briefs.length).toBeGreaterThanOrEqual(7);
    expect(subjects.some((subject) => classifyGeoffreyTopicDomain(subject) === 'sports_competition')).toBe(false);
    expect(subjects.filter(isGeoffreyDeepTechnicalTopic).length).toBeLessThanOrEqual(1);
    expect(subjects.filter(isGeoffreyManufacturingMaterialsTopic).length).toBeLessThanOrEqual(1);
    const domainCounts = briefs.reduce((counts, entry) => {
      const domain = classifyGeoffreyTopicDomain(`${entry.topic} ${entry.title}`);
      counts.set(domain, (counts.get(domain) || 0) + 1);
      return counts;
    }, new Map<string, number>());
    expect(Math.max(...domainCounts.values())).toBeLessThanOrEqual(2);
  });

  it('lets an idea rejection block its premise without suppressing the whole native topic', () => {
    const blocks: SemanticBlock[] = [{
      schemaVersion: 2,
      id: 'idea-startup-rejection',
      agentId: 'agent-1',
      scope: 'idea',
      semanticKey: 'founder:startup:product:speed',
      topic: 'startups',
      storyClusterId: null,
      ideaId: null,
      reasonCode: 'bad_premise',
      reason: 'Reject this one startup premise.',
      permanent: false,
      blockedUntil: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    }];
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI', 'markets', 'health'] } } as any,
      learnings: {
        manualTopicProfile: [
          { topic: 'startups', angle: 'company building', weight: 20, sampleCount: 12, avgEngagement: 50, topTweets: [] },
          { topic: 'markets', angle: 'capital allocation', weight: 18, sampleCount: 8, avgEngagement: 45, topTweets: [] },
        ],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      blocks,
    });

    expect(briefs.some((entry) => entry.topic === 'startups')).toBe(true);
  });

  it('turns native question frequency into a rolling generation budget', () => {
    const allTweets = Array.from({ length: 6 }, (_, index) => ({
      id: `posted-${index}`,
      agentId: 'agent-1',
      content: index < 3 ? `why is this startup question ${index}?` : `startup observation ${index} lands plainly`,
      status: 'posted',
      createdAt: `2026-08-12T0${index}:00:00.000Z`,
    } as Tweet));
    const constraints = buildGenerationWritingConstraintsV2({
      count: 2,
      allTweets,
      learnings: {
        operatorVoiceReference: {
          styleFingerprint: { questionRatio: 7 },
        },
      } as any,
      memory: null,
    });

    expect(constraints.targetQuestionPercent).toBe(7);
    expect(constraints.recentQuestionCount).toBe(3);
    expect(constraints.maxQuestionDraftsInBatch).toBe(0);
    expect(isQuestionDraftV2('is every exec departure a company verdict?')).toBe(true);
    expect(isQuestionDraftV2('exec departures are not company verdicts.')).toBe(false);
    expect(isQuestionDraftV2("when a levered fund blows up, that's the buy.")).toBe(false);
    expect(isQuestionDraftV2('when will a levered fund blow up')).toBe(true);
  });

  it('turns broad Geoffrey topics into distinct creative objects without treating seeds as evidence', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const briefs = buildGenerationBriefsV2({
      count: 2,
      requestedTopic: null,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets', 'culture'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });
    const operatorBriefs = briefs.filter((entry) => entry.evidenceMode === 'operator_opinion');
    const prompt = JSON.parse(buildIdeaGenerationPromptV2(operatorBriefs, geoffreyVoiceProfile));

    expect(operatorBriefs.every((entry) => entry.creativeSeed?.object && entry.evidence.length === 0)).toBe(true);
    expect(new Set(operatorBriefs.map((entry) => entry.creativeSeed?.id)).size).toBe(operatorBriefs.length);
    expect(prompt.requirements.creativeSeedContract).toContain('never evidence');
    expect(prompt.briefs.every((entry: any) => entry.creativeSeed && entry.evidence.length === 0)).toBe(true);
    expect(prompt.briefs.every((entry: any) => (
      entry.creativeSeed.publicReactionPrompt
      && !entry.creativeSeed.hiddenConstraint
      && !entry.creativeSeed.nonConsensusDirection
    ))).toBe(true);
  });

  it('rotates Geoffrey creative seeds across independent generation runs', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const build = (seedRotationKey: string) => buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: ['AI', 'startups', 'markets', 'culture'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      seedRotationKey,
    });
    const first = build('run-a').map((entry) => entry.creativeSeed?.id);
    const second = build('run-b').map((entry) => entry.creativeSeed?.id);

    expect(second).not.toEqual(first);
  });

  it('rotates among proven Geoffrey topic lanes instead of replaying the same four briefs', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const manualTopicProfile = [
      'AI',
      'startups',
      'finance',
      'energy',
      'robotics',
      'space',
      'culture',
      'health',
    ].map((topic) => ({
      topic,
      angle: '',
      weight: 1,
      sampleCount: 5,
      avgEngagement: 50,
      topTweets: [],
    }));
    const build = (seedRotationKey: string) => buildGenerationBriefsV2({
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: [] } } as any,
      learnings: { manualTopicProfile } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      seedRotationKey,
    }).map((entry) => entry.topic);

    const first = build('topic-run-a');
    const second = build('topic-run-b');
    const third = build('topic-run-c');

    expect(new Set(first).size).toBe(4);
    expect(new Set([...first, ...second, ...third]).size).toBeGreaterThan(4);
  });

  it('rotates one failed topic lane without discarding the proven portfolio', () => {
    const geoffreyVoiceProfile = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const manualTopicProfile = [
      'AI',
      'startups',
      'finance',
      'energy',
      'robotics',
      'space',
      'culture',
      'health',
    ].map((topic) => ({
      topic,
      angle: '',
      weight: 1,
      sampleCount: 5,
      avgEngagement: 50,
      topTweets: [],
    }));
    const common = {
      count: 2,
      stories: [],
      documents: [],
      voiceProfile: geoffreyVoiceProfile,
      analysis: { engagementPatterns: { topTopics: [] } } as any,
      learnings: { manualTopicProfile } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
      seedRotationKey: 'same-refill-seed',
      now: new Date('2026-08-14T06:00:00.000Z'),
    };
    const first = buildGenerationBriefsV2({ ...common, recentIdeas: [] });
    const recentIdeas = first.flatMap((brief, briefIndex) => [0, 1, 2].map((ideaIndex) => ({
      id: `idea-${briefIndex}-${ideaIndex}`,
      briefId: brief.id,
      topic: brief.topic,
      generationRunId: 'generation-recent',
      createdAt: '2026-08-14T05:30:00.000Z',
    }))) as any;
    const second = buildGenerationBriefsV2({ ...common, recentIdeas });

    const freshTopics = second.filter((brief) => !first.some((prior) => prior.topic === brief.topic));
    const retainedTopics = second.filter((brief) => first.some((prior) => prior.topic === brief.topic));
    expect(freshTopics.length).toBeGreaterThanOrEqual(1);
    expect(retainedTopics.length).toBeGreaterThanOrEqual(2);
  });

  it('uses operator history as topic-level strategy rather than replaying its premise', () => {
    const briefs = buildGenerationBriefsV2({
      count: 2,
      requestedTopic: null,
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups'] } } as any,
      learnings: {
        manualTopicProfile: [{
          topic: 'startups',
          angle: 'EXACT DOWNFALL SCHADENFREUDE PREMISE',
          weight: 1,
          sampleCount: 5,
          avgEngagement: 39,
          topTweets: [],
        }],
      } as any,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
      trending: null,
      allTweets: [],
    });
    const startupBrief = briefs.find((entry) => entry.topic === 'startups');

    expect(startupBrief?.summary).toContain('Topic-level history: 5 operator-written posts');
    expect(JSON.stringify(startupBrief)).not.toContain('EXACT DOWNFALL SCHADENFREUDE PREMISE');
  });

  it('treats a manual request as the only subject and never as evidence', () => {
    const briefs = buildGenerationBriefsV2({
      count: 1,
      requestedTopic: 'AI agents and founder leverage',
      stories: [],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'AI hardware'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(briefs).toEqual([expect.objectContaining({
      topic: 'AI agents and founder leverage',
      evidenceMode: 'operator_opinion',
      evidenceIds: [],
    })]);
  });

  it('does not turn a stale cached story into a generation brief', () => {
    const staleStory = {
      schemaVersion: 2,
      id: 'story-stale',
      agentId: 'agent-1',
      semanticKey: 'old:inference:release',
      title: 'An old inference release',
      summary: 'The release is no longer current.',
      topic: 'AI infrastructure',
      entities: ['Acme'],
      sourceDocumentIds: ['source-stale'],
      qualifiedClaimIds: ['claim-stale'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.05, novelty: 0.8, networkMomentum: 0, total: 0.7 },
      firstSeenAt: '2025-01-01T00:00:00.000Z',
      lastSeenAt: '2025-01-01T00:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [staleStory],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'AI hardware'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(briefs.every((entry) => entry.storyClusterId !== staleStory.id)).toBe(true);
  });

  it('filters stories below the same identity threshold used by the idea gate', () => {
    const lowFitStory = {
      schemaVersion: 2,
      id: 'story-low-fit',
      agentId: 'agent-1',
      semanticKey: 'consumer:promotion',
      title: 'A consumer promotion gains attention',
      summary: 'The promotion is moving through a broad network.',
      topic: 'consumer promotion',
      entities: ['Promotion'],
      sourceDocumentIds: ['source-low-fit'],
      qualifiedClaimIds: ['claim-low-fit'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.2, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0.8, total: 0.8 },
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-01T12:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [lowFitStory],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'AI hardware'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
      allTweets: [],
    });

    expect(briefs.every((entry) => entry.storyClusterId !== lowFitStory.id)).toBe(true);
  });

  it('requires both author fit and consequence before spending generation compute on a story', () => {
    const qualified = {
      schemaVersion: 2,
      id: 'story-qualified',
      agentId: 'agent-1',
      semanticKey: 'inference:capacity:contract',
      title: 'An inference provider changes capacity contracts',
      summary: 'The contract changes when buyers must reserve capacity.',
      topic: 'AI infrastructure',
      entities: ['InferenceCo'],
      sourceDocumentIds: ['source-qualified'],
      qualifiedClaimIds: ['claim-qualified'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.8, evidenceStrength: 0.9, consequence: 0.7, freshness: 0.9, novelty: 0.8, networkMomentum: 0, total: 0.8 },
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-01T12:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;

    expect(isStoryEditoriallyQualifiedV2(qualified)).toBe(true);
    expect(isStoryEditoriallyQualifiedV2({
      ...qualified,
      id: 'story-generic-fit',
      scores: { ...qualified.scores, identityFit: 0.5 },
    })).toBe(false);
    expect(isStoryEditoriallyQualifiedV2({
      ...qualified,
      id: 'story-low-consequence',
      scores: { ...qualified.scores, consequence: 0.22 },
    })).toBe(false);
    const filingStub = {
      ...qualified,
      id: 'story-range-filing',
      title: 'SCHEDULE 13G/A - Magnolia Capital Fund, LP (Filed by)',
    };
    expect(getStoryEditorialRejectionCodesV2(filingStub)).toContain('filing_stub');
    expect(isStoryEditoriallyQualifiedV2(filingStub)).toBe(false);
    expect(isStoryEditoriallyQualifiedV2({
      ...qualified,
      id: 'story-form-four',
      title: '4 - Example Corp (Issuer)',
    })).toBe(false);
    expect(isStoryEditoriallyQualifiedV2({
      ...qualified,
      id: 'story-sdk-version',
      title: 'sdk: v0.117.1',
    })).toBe(false);
    expect(isStoryEditoriallyQualifiedV2({
      ...qualified,
      id: 'story-geoffrey-low-consequence',
      scores: { ...qualified.scores, consequence: 0.48 },
    }, { minConsequence: 0.55 })).toBe(false);
  });

  it('treats a re-clustered version of an already published story as consumed', () => {
    const story = {
      schemaVersion: 2,
      id: 'story-lightcap-new-cluster',
      agentId: 'agent-1',
      semanticKey: 'brad:lightcap:openai:departure:new:company',
      title: 'Brad Lightcap leaves OpenAI to start a new company',
      summary: 'Lightcap is leaving OpenAI after eight years and plans to build something new.',
      topic: 'Brad Lightcap leaves OpenAI',
      entities: ['Brad Lightcap', 'OpenAI'],
      sourceDocumentIds: ['source-lightcap'],
      qualifiedClaimIds: ['claim-lightcap'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0.8, total: 0.9 },
      firstSeenAt: '2026-08-12T00:00:00.000Z',
      lastSeenAt: '2026-08-12T01:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const published = [{
      id: 'tweet-lightcap-old-cluster',
      agentId: 'agent-1',
      content: 'lightcap was at openai since 2018 and just announced he is out to build something new.',
      topic: 'OpenAI leadership',
      storyClusterId: 'story-lightcap-old-cluster',
      status: 'posted',
      createdAt: '2026-08-12T03:00:00.000Z',
      postedAt: '2026-08-12T03:00:00.000Z',
    } as Tweet];

    expect(isStoryAlreadyCommittedV2(story, published, new Date('2026-08-13T00:00:00.000Z'))).toBe(true);
    expect(getStoryGenerationPlanningRejectionCodesV2(story, {
      committedTweets: published,
      now: new Date('2026-08-13T00:00:00.000Z'),
    })).toContain('already_committed');
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [story],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'AI'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 35, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
      allTweets: published,
      now: new Date('2026-08-13T00:00:00.000Z'),
    });
    expect(briefs.some((entry) => entry.storyClusterId === story.id)).toBe(false);
  });

  it('cools down the same failed story even when research assigns a new cluster id', () => {
    const currentStory = {
      schemaVersion: 2,
      id: 'story-lightcap-reclustered',
      agentId: 'agent-1',
      semanticKey: 'brad:lightcap:openai:departure:new:company',
      title: 'Brad Lightcap departs OpenAI to build a new company',
      summary: 'The executive said he is leaving OpenAI to start something new.',
      topic: 'Brad Lightcap leaves OpenAI',
      entities: ['Brad Lightcap', 'OpenAI'],
      sourceDocumentIds: ['source-lightcap'],
      qualifiedClaimIds: ['claim-lightcap'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0.8, total: 0.9 },
      firstSeenAt: '2026-08-12T00:00:00.000Z',
      lastSeenAt: '2026-08-12T01:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const failedIdeas = [0, 1, 2].map((index) => ({
      schemaVersion: 2,
      id: `idea-lightcap-${index}`,
      agentId: 'agent-1',
      generationRunId: 'run-lightcap-rejected',
      briefId: 'brief-lightcap',
      storyClusterId: 'story-lightcap-original',
      topic: 'Brad Lightcap leaves OpenAI',
      claim: 'Brad Lightcap is leaving OpenAI to build something new',
      tension: 'The internet is treating the executive departure as a company verdict',
      implication: 'The same departure story is being stretched into another generic OpenAI take',
      authorReason: 'The author invests in AI founders and company formation',
      evidenceIds: ['source-lightcap'],
      counterargument: null,
      factualRisk: 'low',
      semanticKey: `brad:lightcap:openai:departure:${index}`,
      noveltyScore: 0.8,
      evidenceScore: 0.9,
      identityScore: 0.9,
      judgeScore: 0.4,
      status: 'rejected',
      rejectionCodes: ['idea_judge_generic_premise'],
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:01:00.000Z',
    } satisfies IdeaCandidate));
    const attempts = buildFailedStoryAttemptsV2(failedIdeas, new Date('2026-08-13T00:00:00.000Z'));

    expect(attempts).toHaveLength(1);
    expect(isStoryInEditorialCooldownV2(currentStory, attempts)).toBe(true);
  });

  it('carries failed-story cooldown across copy policy versions', () => {
    const failedIdeas = [0, 1, 2].map((index) => ({
      schemaVersion: 2,
      id: `idea-old-policy-${index}`,
      agentId: 'agent-1',
      generationRunId: 'run-old-policy',
      qualityPolicyVersion: 'publishing-v2-hard-gates-old',
      briefId: 'brief-current-story',
      storyClusterId: 'story-current',
      topic: 'AI startups',
      claim: 'A current sourced event happened.',
      tension: 'The old policy rejected the evidence representation.',
      implication: 'The repaired policy should be allowed to retry it.',
      authorReason: 'The author follows AI company formation.',
      evidenceIds: ['source-current'],
      counterargument: null,
      factualRisk: 'low',
      semanticKey: `ai:startup:current:${index}`,
      noveltyScore: 0.8,
      evidenceScore: 0.9,
      identityScore: 0.9,
      judgeScore: 0.4,
      status: 'rejected',
      rejectionCodes: ['claim_not_grounded_in_evidence'],
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:01:00.000Z',
    } satisfies IdeaCandidate));

    const attempts = buildFailedStoryAttemptsV2(
      failedIdeas,
      new Date('2026-08-13T00:00:00.000Z'),
    );
    const makeStory = (id: string, title: string, topic: string, entities: string[]): StoryCluster => ({
      schemaVersion: 2,
      id,
      agentId: 'agent-1',
      semanticKey: buildResearchSemanticKey(title, entities),
      title,
      summary: title,
      topic,
      entities,
      sourceDocumentIds: [`source-${id}`],
      qualifiedClaimIds: [`claim-${id}`],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0.8, total: 0.9 },
      firstSeenAt: '2026-08-12T00:00:00.000Z',
      lastSeenAt: '2026-08-12T01:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    });

    expect(attempts).toHaveLength(1);
    expect(isStoryInEditorialCooldownV2(
      makeStory('story-current', 'Current AI startup event', 'AI startups', ['AI startup']),
      attempts,
    )).toBe(true);
    expect(isStoryInEditorialCooldownV2(
      makeStory('story-unrelated', 'A fusion startup reaches a new plasma milestone', 'fusion energy', ['fusion', 'plasma']),
      attempts,
    )).toBe(false);
  });

  it('does not cool a story after another run demonstrated a viable selected premise', () => {
    const failedIdeas = [0, 1, 2].map((index) => ({
      schemaVersion: 2,
      id: `idea-failed-${index}`,
      agentId: 'agent-1',
      generationRunId: 'run-failed',
      qualityPolicyVersion: 'publishing-v2-hard-gates-102',
      briefId: 'brief-battery',
      storyClusterId: 'story-battery',
      topic: 'energy',
      claim: 'Australian home batteries helped reduce wholesale power prices.',
      tension: 'Distributed household hardware is changing grid economics.',
      implication: 'Home batteries should be evaluated as grid infrastructure.',
      authorReason: 'The author follows frontier energy businesses.',
      evidenceIds: ['source-battery'],
      counterargument: null,
      factualRisk: 'low',
      semanticKey: `australia:home:battery:${index}`,
      noveltyScore: 0.8,
      evidenceScore: 0.9,
      identityScore: 0.9,
      judgeScore: 0.4,
      status: 'rejected',
      rejectionCodes: ['idea_judge_generic_premise'],
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:01:00.000Z',
    } satisfies IdeaCandidate));
    const selectedIdea = {
      ...failedIdeas[0],
      id: 'idea-selected',
      generationRunId: 'run-selected',
      status: 'selected',
      rejectionCodes: [],
      judgeScore: 0.86,
      updatedAt: '2026-08-12T20:02:00.000Z',
    } satisfies IdeaCandidate;

    const attempts = buildFailedStoryAttemptsV2(
      [...failedIdeas, selectedIdea],
      new Date('2026-08-13T00:00:00.000Z'),
    );

    expect(attempts).toHaveLength(0);
  });

  it('does not spend research brief slots on a permanently rejected subject', () => {
    const makeStory = (id: string, title: string, topic: string, total: number): StoryCluster => ({
      schemaVersion: 2,
      id,
      agentId: 'agent-1',
      semanticKey: buildResearchSemanticKey(`${topic} ${title}`),
      title,
      summary: title,
      topic,
      entities: topic.split(/\s+/),
      sourceDocumentIds: [`source-${id}`],
      qualifiedClaimIds: [`claim-${id}`],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0, total },
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-01T12:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    });
    const blockedStory = makeStory('story-pfl', 'MVP and PFL merge their combat sports promotions', 'PFL MVP merger', 0.95);
    const usableStory = makeStory('story-ai', 'Tiny teams are shipping useful robotics systems', 'robotics startups', 0.75);
    const briefs = buildGenerationBriefsV2({
      count: 2,
      stories: [blockedStory, usableStory],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'AI hardware'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
      allTweets: [],
      blocks: [{
        schemaVersion: 2,
        id: 'block-pfl-mvp',
        agentId: 'agent-1',
        scope: 'idea',
        semanticKey: 'and:like:mvp:not:pfl:remove:tweet',
        topic: null,
        storyClusterId: null,
        ideaId: null,
        reasonCode: 'bad_premise',
        reason: 'Remove it and do not regenerate this PFL/MVP merger angle.',
        permanent: true,
        blockedUntil: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    });

    expect(briefs.some((entry) => entry.storyClusterId === blockedStory.id)).toBe(false);
    expect(briefs.some((entry) => entry.storyClusterId === usableStory.id)).toBe(true);
  });

  it('does not consume a sourced story when only its generated copy was rejected', () => {
    const story = {
      schemaVersion: 2,
      id: 'story-copy-rejected',
      agentId: 'agent-1',
      semanticKey: 'robotics:factory:release',
      title: 'A robotics company releases a new factory system',
      summary: 'The system changes factory deployment economics.',
      topic: 'robotics startups',
      entities: ['RoboticsCo'],
      sourceDocumentIds: ['source-robotics'],
      qualifiedClaimIds: ['claim-robotics'],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, novelty: 0.8, networkMomentum: 0, total: 0.85 },
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-01T12:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const common = {
      count: 2,
      stories: [story],
      documents: [],
      voiceProfile,
      analysis: { engagementPatterns: { topTopics: ['startups', 'health', 'AI hardware'] } } as any,
      learnings: null,
      style: { autonomyMode: 'balanced', trendMixTarget: 40, trendTolerance: 'adjacent', exploration: { underusedTopics: ['markets'] } } as any,
      trending: null,
    };

    const afterWritingRejection = buildGenerationBriefsV2({
      ...common,
      allTweets: [{
        id: 'draft-rejected',
        status: 'draft',
        storyClusterId: story.id,
        generationRunId: 'run-rejected',
        quarantinedAt: '2026-08-01T13:00:00.000Z',
      } as any],
    });
    const whileQueued = buildGenerationBriefsV2({
      ...common,
      allTweets: [{
        id: 'draft-queued',
        status: 'queued',
        storyClusterId: story.id,
        generationRunId: 'run-queued',
      } as any],
    });

    expect(afterWritingRejection.some((entry) => entry.storyClusterId === story.id)).toBe(true);
    expect(whileQueued.some((entry) => entry.storyClusterId === story.id)).toBe(false);
  });

  it('keeps quarantined and uncommitted drafts out of published-copy duplicate memory', () => {
    const tweets = [
      { id: 'quarantined', status: 'quarantined', content: 'Rejected copy.' },
      { id: 'draft', status: 'draft', content: 'Unreviewed copy.' },
      { id: 'preview', status: 'preview', content: 'Preview copy.' },
      { id: 'legacy-quarantined', status: 'queued', quarantinedAt: '2026-08-01T13:00:00.000Z', content: 'Legacy quarantined copy.' },
      { id: 'queued', status: 'queued', content: 'Queued copy.' },
      { id: 'posted', status: 'posted', content: 'Posted copy.' },
      { id: 'deleted', status: 'deleted_from_x', content: 'Deleted live copy.' },
    ] as Tweet[];

    expect(getCommittedTweetCopyMemoryV2(tweets)).toEqual([
      'Queued copy.',
      'Posted copy.',
      'Deleted live copy.',
    ]);
    expect(getCommittedTweetCopyMemoryV2(tweets, { excludeTweetId: 'queued' })).toEqual([
      'Posted copy.',
      'Deleted live copy.',
    ]);
  });

  it('rejects a cited idea when its claim is unrelated to the qualified evidence', () => {
    const sourcedBrief = brief('sourced', 'AI infrastructure', 'verified_source');
    const source = {
      schemaVersion: 2,
      id: 'source-sourced',
      agentId: 'agent-1',
      sourceType: 'official',
      canonicalUrl: 'https://example.com/source',
      title: 'Inference serving costs fall',
      publisher: 'Acme',
      publishedAt: '2026-08-01T10:00:00.000Z',
      fetchedAt: '2026-08-01T11:00:00.000Z',
      trustTier: 'primary',
      isPrimary: true,
      excerpt: 'Acme reduced inference serving costs for production models.',
      contentHash: 'hash-source',
      entities: ['Acme'],
      claims: [{
        id: 'claim-sourced',
        text: 'Inference serving costs fell for production AI models.',
        kind: 'measurement',
        confidence: 0.9,
        entities: ['Acme'],
      }],
      topics: ['AI infrastructure'],
      query: null,
      metadata: {},
    } satisfies SourceDocument;
    const ideas = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('sourced', 'A boxing promotion merger changes athlete distribution.'),
        evidenceIds: ['source-sourced'],
      }],
      agentId: 'agent-1',
      runId: 'run-evidence',
      briefs: [sourcedBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      documents: [source],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).toContain('claim_not_grounded_in_evidence');
  });

  it('accepts a sourced idea anchored by a short distinctive release phrase', () => {
    const sourcedBrief = brief('release', 'AI developer tools', 'verified_source');
    sourcedBrief.evidenceIds = ['source-release'];
    sourcedBrief.sourceDocumentIds = ['source-release'];
    sourcedBrief.qualifiedClaimIds = ['claim-release'];
    const source = {
      schemaVersion: 2,
      id: 'source-release',
      agentId: 'agent-1',
      sourceType: 'github_releases',
      canonicalUrl: 'https://github.com/example/sdk/releases/tag/v2',
      title: 'v2',
      publisher: 'example/sdk',
      publishedAt: '2026-08-01T10:00:00.000Z',
      fetchedAt: '2026-08-01T11:00:00.000Z',
      trustTier: 'primary',
      isPrimary: true,
      excerpt: 'Features api: fast tier.',
      contentHash: 'hash-release',
      entities: [],
      claims: [{
        id: 'claim-release',
        text: 'Features api: fast tier.',
        kind: 'fact',
        confidence: 0.9,
        entities: [],
      }],
      topics: ['AI developer tools'],
      query: null,
      metadata: {},
    } satisfies SourceDocument;
    const ideas = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('release', 'A first-class fast tier makes latency an explicit product choice for agent developers.'),
        evidenceIds: ['source-release'],
      }],
      agentId: 'agent-1',
      runId: 'run-release',
      briefs: [sourcedBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      documents: [source],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).not.toContain('claim_not_grounded_in_evidence');
  });

  it('accepts a multi-number comparison explicitly stated together in the source excerpt', () => {
    const sourcedBrief = {
      ...brief('computer-use', 'computer-use agents', 'verified_source'),
      qualifiedClaimIds: ['claim-before', 'claim-now', 'claim-human'],
    } satisfies GenerationBriefV2;
    const source = {
      id: 'source-computer-use',
      excerpt: 'A year ago, the best computer-use model scored 42% on the standard real-desktop benchmark. Today it scores 85%. Human testers score about 72% on the same tasks.',
      claims: [{
        id: 'claim-before',
        text: 'A year ago, the best computer-use model scored 42% on the standard real-desktop benchmark.',
        kind: 'measurement',
      }, {
        id: 'claim-now',
        text: 'Today the best computer-use model scores 85% on the standard real-desktop benchmark.',
        kind: 'measurement',
      }, {
        id: 'claim-human',
        text: 'Human testers score about 72% on the same tasks.',
        kind: 'measurement',
      }],
    } as SourceDocument;
    const ideas = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('computer-use', 'The best computer-use model moved from 42% to 85% on the cited real-desktop benchmark, compared with about 72% for human testers.'),
        evidenceIds: ['source-computer-use'],
      }],
      agentId: 'agent-1',
      runId: 'run-computer-use',
      briefs: [sourcedBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      documents: [source],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).not.toContain('claim_not_grounded_in_evidence');
  });

  it('rejects an idea that combines numbers from separately scoped evidence claims', () => {
    const sourcedBrief = {
      ...brief('minerals', 'critical minerals', 'verified_source'),
      qualifiedClaimIds: ['claim-production', 'claim-reserves'],
      evidence: [{
        sourceDocumentId: 'source-minerals',
        claimId: 'claim-production',
        publisher: 'USGS',
        publishedAt: '2026-08-01T10:00:00.000Z',
        claim: 'Of 77 commodities, China produced 74 and ranked first for 39.',
      }, {
        sourceDocumentId: 'source-minerals',
        claimId: 'claim-reserves',
        publisher: 'USGS',
        publishedAt: '2026-08-01T10:00:00.000Z',
        claim: 'Reserve shares ranged from 20 percent for zinc to 52 percent for tungsten.',
      }],
    } satisfies GenerationBriefV2;
    const source = {
      id: 'source-minerals',
      claims: [{ id: 'claim-production', text: sourcedBrief.evidence[0].claim, kind: 'measurement' }, {
        id: 'claim-reserves', text: sourcedBrief.evidence[1].claim, kind: 'measurement',
      }],
    } as SourceDocument;
    const ideas = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('minerals', 'China led 39 commodities while holding 20–52% of reserves for those same commodities.'),
        evidenceIds: ['source-minerals'],
      }],
      agentId: 'agent-1',
      runId: 'run-mineral-scope',
      briefs: [sourcedBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      documents: [source],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['claim_not_grounded_in_evidence']),
    });
  });

  it('rejects PFL/MVP reskins, repeated explainers, political drift, and missing evidence before writing', () => {
    const briefs = [
      brief('pfl', 'PFL MVP boxing merger'),
      brief('mineral', 'critical minerals'),
      brief('politics', 'AI startups'),
      brief('sourced', 'AI infrastructure', 'verified_source'),
      brief('valid', 'founder leverage'),
    ];
    const blocks: SemanticBlock[] = [{
      schemaVersion: 2,
      id: 'block-mineral',
      agentId: 'agent-1',
      scope: 'idea',
      semanticKey: buildResearchSemanticKey('critical mineral supply chains need another technical explainer'),
      topic: 'critical minerals',
      storyClusterId: null,
      ideaId: null,
      reasonCode: 'bad_premise',
      reason: 'Repeated mineral explainer.',
      permanent: true,
      blockedUntil: null,
      createdAt: '2026-08-01T00:00:00.000Z',
    }];
    const ideas = normalizeIdeaCandidatesV2({
      raw: [
        rawIdea('pfl', 'PFL buying MVP is really buying Jake Paul distribution and attention for fights.'),
        rawIdea('mineral', 'Critical mineral supply chains deserve another technical explainer for startup founders.'),
        rawIdea('politics', 'The presidential election should determine which AI startups founders build next.'),
        rawIdea('sourced', 'Inference economics changed enough to alter how AI infrastructure companies form.'),
        rawIdea('valid', 'AI gives tiny founder teams leverage before it gives large companies efficiency.'),
      ],
      agentId: 'agent-1',
      runId: 'run-1',
      briefs,
      voiceProfile,
      recentPosts: ['PFL buying MVP is mostly a purchase of Jake Paul distribution and his ability to make people care about a fight.'],
      blocks,
      now: '2026-08-01T12:00:00.000Z',
    });

    const byBrief = new Map(ideas.map((idea) => [idea.briefId, idea]));
    expect(byBrief.get('pfl')?.rejectionCodes).toContain('recent_semantic_repeat');
    expect(byBrief.get('mineral')?.rejectionCodes.some((code) => code.startsWith('blocked_'))).toBe(true);
    expect(byBrief.get('politics')?.rejectionCodes).toContain('political_drift');
    expect(byBrief.get('sourced')?.rejectionCodes).toContain('missing_verified_evidence');
    expect(byBrief.get('valid')?.status).toBe('generated');
  });

  it('blocks concept-level reskins of a manual premise even when the nouns change', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'finance',
        'Most blown-up tech trades were killed by the margin agreement months before the market ever moved.',
      )],
      agentId: 'agent-1',
      runId: 'run-concept-reskin',
      briefs: [brief('finance', 'finance')],
      voiceProfile,
      recentPosts: [
        'SALP is still directionally correct, but he scaled too fast with leverage and underestimated how savage Wall Street can be.',
      ],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['recent_semantic_repeat']),
    });
  });

  it('blocks noun-swapped acquisition and CEO sentence skeletons', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('ai', 'OpenAI should buy Linear and make Karri Saarinen ceo.')],
      agentId: 'agent-1',
      runId: 'run-acquisition-skeleton-reskin',
      briefs: [brief('ai', 'AI companies')],
      voiceProfile,
      recentPosts: ['google should buy @cognition for $200b and make @ScottWu46 ceo'],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['recent_semantic_repeat']),
    });
  });

  it('blocks a direct should-buy reskin even when the CEO clause is removed', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('ai', 'OpenAI should buy Linear because agents need to own the issue tracker.')],
      agentId: 'agent-1',
      runId: 'run-direct-acquisition-reskin',
      briefs: [brief('ai', 'AI companies')],
      voiceProfile,
      recentPosts: ['google should buy @cognition for $200b and make @ScottWu46 ceo'],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['recent_semantic_repeat']),
    });
  });

  it('blocks replaying the back-someone-after-failure premise', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('culture', 'I would rather back someone after a loud failure than a beige win.')],
      agentId: 'agent-1',
      runId: 'run-failure-reskin',
      briefs: [brief('culture', 'culture')],
      voiceProfile,
      recentPosts: ['I am long Leopold. He will be back stronger and tougher than ever after the blow-up.'],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['recent_semantic_repeat']),
    });
  });

  it('keeps live operator briefs factual-claim free', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', 'OpenAI announced today that every founder gets a $25 million credit.')],
      agentId: 'agent-1',
      runId: 'run-operator-fact',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
    });
  });

  it('derives idea provenance from the brief instead of model-authored voice rationale', () => {
    const operatorBrief = {
      ...brief('operator', 'startups'),
      authorOpportunity: 'The operator topic profile supports a fresh startup judgment.',
    };
    const ideas = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('operator', 'I would rather own the startup with one painful customer than ten polite pilots.'),
        authorReason: 'Provocateur mode: compressed memo exactly matching the requested persona.',
      }],
      agentId: 'agent-1',
      runId: 'run-derived-author-provenance',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].authorReason).toBe(operatorBrief.authorOpportunity);
    expect(ideas[0].authorReason).not.toContain('Provocateur mode');
  });

  it('blocks unsourced product-change phrasing even when it is wrapped in an opinion', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'I think Google putting frontier AI inside Workspace makes standalone email-writing startups worth less.',
      )],
      agentId: 'agent-1',
      runId: 'run-operator-product-change',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
    });
  });

  it('rejects source-free operator mechanisms before they consume writer slots', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', 'Private fund LP behavior changes when a redemption window opens.')],
      agentId: 'agent-1',
      runId: 'run-operator-capital-mechanism',
      briefs: [brief('operator', 'finance')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
    });
  });

  it('allows bounded future mechanisms without opening the evidence gate to current facts or metrics', () => {
    expect(hasUnsupportedOperatorEvidenceV2(
      'within 12 months, gallium nitride capacity will get defense-tech pricing as qualification becomes the bottleneck.',
    )).toBe(false);
    expect(hasUnsupportedOperatorEvidenceV2(
      'gallium nitride capacity gets defense-tech pricing because qualification is the bottleneck.',
    )).toBe(true);
    expect(hasUnsupportedOperatorEvidenceV2(
      'within 12 months, 10 factories will get defense-tech pricing as qualification becomes the bottleneck.',
    )).toBe(true);
    expect(hasUnsupportedOperatorEvidenceV2(
      'within 9 months, coding agents could make software companies with 20 people before launch look overbuilt.',
    )).toBe(true);
    expect(hasUnsupportedOperatorEvidenceV2(
      'within 9 months, coding agents could make 20-person pre-launch software teams look overbuilt.',
    )).toBe(true);
    expect(hasUnsupportedOperatorEvidenceV2(
      'OpenAI announced a power project today and will own generation within 12 months.',
    )).toBe(true);
  });

  it('allows an explicit operator financing preference without pretending it is sourced fact', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'For a capital-intensive technology company with unresolved product risk, I would choose equity before project finance.',
      )],
      agentId: 'agent-1',
      runId: 'run-operator-capital-preference',
      briefs: [brief('operator', 'finance')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).not.toContain('unsupported_operator_fact');
  });

  it('allows a clearly speculative valuation call with a number', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'Google should buy @cognition for $200b and make @ScottWu46 ceo.',
      )],
      agentId: 'agent-1',
      runId: 'run-operator-valuation-opinion',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).not.toContain('unsupported_operator_fact');
    const writingPrompt = JSON.parse(buildTweetWritingPromptV2(
      ideas[0],
      brief('operator', 'AI startups'),
      [],
      [],
    ));
    expect(writingPrompt.factualWritingContract).toContain('Preserve an approved subjective valuation');
  });

  it('accepts curly-apostrophe market positions and modal acquisition desires as opinions', () => {
    const operatorBrief = brief('operator', 'AI and markets');
    const ideas = normalizeIdeaCandidatesV2({
      raw: [{
        ...rawIdea('operator', 'I’d rather own TSMC than a generic basket of public AI software stocks.'),
        tension: 'Valuation and product risk can point to different ownership choices.',
        implication: 'My capital would move toward TSMC unless the software price changed the trade.',
      }, {
        ...rawIdea('operator', 'I want OpenAI to buy Linear and make project execution native inside ChatGPT.'),
        tension: 'The acquisition would connect generated work to the place where teams revise and ship it.',
        implication: 'I would treat the deal as an application-software ambition signal.',
      }, {
        ...rawIdea('operator', 'NVIDIA at a price that needs permanent dominance sounds miserable.'),
        tension: 'NVIDIA the company can remain incredible while the security gets less interesting.',
        implication: 'Custom silicon only needs to become a credible threat for that price to get awkward.',
      }],
      agentId: 'agent-1',
      runId: 'run-operator-modal-market-opinions',
      briefs: [operatorBrief],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas).toHaveLength(3);
    expect(ideas.every((idea) => !idea.rejectionCodes.includes('unsupported_operator_fact'))).toBe(true);
  });

  it('still blocks an asserted completed acquisition without source evidence', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', 'The OpenAI acquisition of Linear closed and makes project execution native inside ChatGPT.')],
      agentId: 'agent-1',
      runId: 'run-operator-asserted-acquisition',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).toContain('unsupported_operator_fact');
  });

  it('blocks a generic source-free product wishlist before writing', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'I want an AI model that can legally control a software company budget and be fired by the board.',
      )],
      agentId: 'agent-1',
      runId: 'run-operator-product-wishlist',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['generic_product_wishlist']),
    });
    expect(isGenericOperatorProductWishlistV2(
      'i want to give an AI agent a corporate card and fire it when it misses budget.',
    )).toBe(true);
    expect(isGenericOperatorProductWishlistV2(
      'i want OpenAI to buy Linear.',
    )).toBe(false);
    expect(isGenericOperatorProductWishlistV2(
      'i want the agent with a corporate card and a painfully low spending limit.',
    )).toBe(true);
    expect(getV2GeneratedWritingIssue(
      'google should stop treating the coding agent like another tab.\n\nmake it the default interface to the entire developer stack.',
    )).toContain('stop-treating-make-default');
    expect(getV2GeneratedWritingIssue(
      'kill the Claude chatbot subscription.\n\nmake Claude Code the product the whole company answers to.',
    )).toBeNull();
  });

  it('rejects reusable social-copy skeletons before paying for drafting', () => {
    const syntheticMoves = [
      'At $40 billion, Cognition no longer gets graded on Devin demos. It gets graded on whether developers reorganize their work around Devin.',
      'Trajectory wins when nobody thinks about which open-source model ran their job.',
      'Trajectory should make model choice boring. If users still pick models, the product stopped one layer too early.',
      'Cognition at $40 billion has no room left to be merely a very good coding startup.',
      'My bar for Cognition at $40 billion: Devin has to become the center of every developer workflow.',
    ];
    const ideas = normalizeIdeaCandidatesV2({
      raw: syntheticMoves.map((move) => rawIdea('operator', move)),
      agentId: 'agent-1',
      runId: 'run-generated-idea-patterns',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas).toHaveLength(3);
    expect(ideas.every((idea) => (
      idea.status === 'rejected'
      && idea.rejectionCodes.includes('generated_idea_pattern')
    ))).toBe(true);
  });

  it('keeps a direct named operator call eligible at idea preflight', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', 'Google should buy Cognition for $200b and make Scott Wu CEO.')],
      agentId: 'agent-1',
      runId: 'run-direct-native-call',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0].rejectionCodes).not.toContain('generated_idea_pattern');
  });

  it('rejects an unsourced measured numeric claim', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('operator', 'OpenAI has 42% market share and the gap is widening.')],
      agentId: 'agent-1',
      runId: 'run-operator-measured-number',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
    });
  });

  it('does not let a valuation opinion launder a separate measured claim', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea(
        'operator',
        'OpenAI has 42% market share and should be worth $200b.',
      )],
      agentId: 'agent-1',
      runId: 'run-operator-mixed-number',
      briefs: [brief('operator', 'AI startups')],
      voiceProfile,
      recentPosts: [],
      blocks: [],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({
      status: 'rejected',
      rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
    });
  });

  it('blocks paraphrases of a permanently rejected named angle before writing', () => {
    const ideas = normalizeIdeaCandidatesV2({
      raw: [rawIdea('pfl', "MVP's highest-value contribution to PFL is cultural distribution rather than fight operations.")],
      agentId: 'agent-1',
      runId: 'run-durable-block',
      briefs: [brief('pfl', 'PFL MVP merger')],
      voiceProfile,
      recentPosts: [],
      blocks: [{
        schemaVersion: 2,
        id: 'block-pfl-mvp',
        agentId: 'agent-1',
        scope: 'idea',
        semanticKey: 'and:like:mvp:not:pfl:remove:tweet',
        topic: null,
        storyClusterId: null,
        ideaId: null,
        reasonCode: 'bad_premise',
        reason: 'I do not like this PFL/MVP tweet. Remove it and do not regenerate this merger angle.',
        permanent: true,
        blockedUntil: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
      now: '2026-08-01T12:00:00.000Z',
    });

    expect(ideas[0]).toMatchObject({ status: 'rejected', rejectionCodes: expect.arrayContaining(['blocked_idea']) });
  });

  it('builds compact stage prompts without turning positive anchors into content templates', () => {
    const currentBrief = brief('sourced', 'AI infrastructure', 'verified_source');
    const idea = {
      ...rawIdea('sourced', 'Lower inference cost changes which AI products can become companies.'),
      schemaVersion: 2,
      id: 'idea-1',
      agentId: 'agent-1',
      generationRunId: 'run-1',
      storyClusterId: 'story-sourced',
      topic: 'AI infrastructure',
      evidenceIds: ['source-sourced'],
      semanticKey: 'ai:inference:cost',
      noveltyScore: 0.9,
      evidenceScore: 0.9,
      identityScore: 0.9,
      judgeScore: null,
      status: 'selected',
      rejectionCodes: [],
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    } satisfies IdeaCandidate;
    const source = {
      id: 'source-sourced', publisher: 'Acme', publishedAt: '2026-08-01T10:00:00.000Z',
      claims: [{ id: 'claim-1', text: 'Acme cut serving cost in its published release.', kind: 'measurement' }],
    } as SourceDocument;
    const ideaPrompt = JSON.parse(buildIdeaGenerationPromptV2(
      [currentBrief],
      voiceProfile,
      [],
      undefined,
      [],
      [],
      [],
      {
        [currentBrief.id]: {
          reactionMode: 'named_call',
          lengthBand: 'short',
          paragraphBand: 'single',
          usesFirstPerson: false,
        },
      },
    ));
    const writingPrompt = JSON.parse(buildTweetWritingPromptV2(idea, currentBrief, [source], [{
      id: 'operator-post-1', content: 'the market usually tells you where the bottleneck moved', topic: 'markets',
    }], undefined, undefined, undefined, 'reconceive', 3, {
      reactionMode: 'named_call',
      lengthBand: 'short',
      paragraphBand: 'single',
      usesFirstPerson: false,
    }));

    expect(ideaPrompt.requirements.ideasPerBrief).toBe(3);
    expect(ideaPrompt.requirements.evidenceIdContract).toContain('not individual claims');
    expect(ideaPrompt.requirements.operatorOpinionContract).toContain('personal judgments, questions, predictions');
    expect(ideaPrompt.requirements.operatorOpinionContract).toContain('subjective valuation');
    expect(ideaPrompt.requirements.geoffreyNativeMoveContract).toBeNull();
    expect(ideaPrompt.requirements.subjectContract).toContain('concrete subject');
    expect(ideaPrompt.requirements.rarePremiseContract).toContain('rare premises');
    expect(ideaPrompt.briefs[0].evidence).toEqual([expect.objectContaining({
      evidenceId: 'source-sourced',
      claim: expect.any(String),
    })]);
    expect(ideaPrompt.briefs[0].evidence[0]).not.toHaveProperty('claimId');
    expect(ideaPrompt.briefs[0].evidence[0]).not.toHaveProperty('sourceDocumentId');
    expect(ideaPrompt.requirements.sameSubjectReactionContract).toContain('prior same-subject premise');
    expect(ideaPrompt.briefs[0].sameSubjectNativeReactionPattern).toEqual(expect.objectContaining({
      reactionMode: 'named_call',
      lengthBand: 'short',
      paragraphBand: 'single',
      usesFirstPerson: false,
      instruction: expect.stringContaining('No prior premise'),
    }));
    expect(writingPrompt).toEqual(expect.objectContaining({
      idea: expect.objectContaining({
        publicMove: idea.publicMove,
        factualBasis: idea.claim,
      }),
      evidenceMode: 'verified_source',
      subjectContext: expect.objectContaining({
        title: 'AI infrastructure',
        instruction: expect.stringContaining('reason to publish now'),
      }),
      factualWritingContract: expect.stringContaining('directly supported'),
      verifiedSourceReactionContract: expect.objectContaining({
        publicMove: expect.stringContaining('reason to react now'),
        opening: expect.stringContaining('author\'s verdict'),
        factSelection: expect.stringContaining('exactly one decisive factual atom'),
        sourceWording: expect.stringContaining('four consecutive words'),
        attribution: expect.stringContaining('shortest accurate trailing'),
      }),
      evidence: [expect.objectContaining({ sourceDocumentId: 'source-sourced' })],
      sameSubjectNativeReactionPattern: expect.objectContaining({
        reactionMode: 'named_call',
        lengthBand: 'short',
        instruction: expect.stringContaining('prior premise and every word'),
      }),
      voiceAnchors: [expect.objectContaining({
        id: 'operator-post-1',
        instruction: expect.stringContaining('Diction and rhythm evidence only'),
      })],
    }));
    expect(writingPrompt.idea).not.toHaveProperty('authorReason');
    expect(writingPrompt.idea).toEqual(expect.objectContaining({
      publicMove: idea.publicMove,
      factualBasis: idea.claim,
      pressure: idea.tension,
      stakes: idea.implication,
      counterargument: idea.counterargument,
      instruction: expect.stringContaining('approved semantic center'),
    }));
    expect(writingPrompt.responseContract.variantMoves.map((entry: any) => entry.move)).toEqual([
      'blunt_reaction',
      'named_call',
      'thought_in_motion',
    ]);
    expect(writingPrompt.responseContract.variantMoves[2].instruction).toContain('Never stage isolated noun fragments');
    expect(writingPrompt.responseContract.diversityContract).toContain('must not share');
    expect(writingPrompt.voiceTransferContract).toEqual(expect.objectContaining({
      primaryRegisterAnchorId: 'operator-post-1',
    }));
    expect(writingPrompt.voiceAnchors[0]).toEqual(expect.objectContaining({ role: 'slot_1_register' }));
    expect(writingPrompt.subjectContext).not.toHaveProperty('creativeSeed');

    const operatorWritingPrompt = JSON.parse(buildTweetWritingPromptV2(
      { ...idea, briefId: 'operator', storyClusterId: null, evidenceIds: [] },
      brief('operator', 'startups'),
      [],
      [],
    ));
    expect(operatorWritingPrompt.factualWritingContract).toContain('personal judgment, question, prediction');
    expect(operatorWritingPrompt.factualWritingContract).toContain('Do not add a current or historical event');
    expect(operatorWritingPrompt.factualWritingContract).toContain('approved idea packet');
    expect(operatorWritingPrompt.verifiedSourceReactionContract).toBeNull();
    const geoffreyVoice = {
      ...voiceProfile,
      summary: `${voiceProfile.summary} Account topic policy for @geoffwoo.`,
    };
    const geoffreyIdeaPrompt = JSON.parse(buildIdeaGenerationPromptV2(
      [brief('operator', 'OpenAI coding agents')],
      geoffreyVoice,
    ));
    const geoffreyWritingPrompt = JSON.parse(buildTweetWritingPromptV2(
      { ...idea, briefId: 'operator', storyClusterId: null, topic: 'OpenAI coding agents', evidenceIds: [] },
      brief('operator', 'OpenAI coding agents'),
      [],
      [],
      undefined,
      undefined,
      undefined,
      'reconceive',
      3,
      null,
      false,
      geoffreyVoice,
    ));
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('6-12');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('trillion-dollar scale');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('robots already piloting');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('nonlinear');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('HARD SHAPE');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('literally include an explicit window');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('semantic constraints, not a sentence template');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('subject will outcome within N months');
    expect(geoffreyIdeaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('does not license a second number');
    expect(geoffreyIdeaPrompt.requirements.verifiedSourceReactionContract).toContain('takes precedence');
    expect(geoffreyWritingPrompt.geoffreyAIFutureHorizon).toEqual(expect.objectContaining({
      lead: expect.stringContaining('6-12 months'),
      currentBaselines: expect.arrayContaining([expect.stringContaining('robots already pilot')]),
      instruction: expect.stringContaining('HARD SHAPE'),
    }));
    expect(geoffreyWritingPrompt.geoffreyAIFutureHorizon.instruction).toContain('semantic atoms, never prose order');
    expect(geoffreyWritingPrompt.geoffreyAIFutureHorizon.instruction).toContain('supplied slot voice anchor');
    expect(geoffreyWritingPrompt.geoffreyAIFutureHorizon.instruction).toContain('never add illustrative headcount');
    expect(geoffreyWritingPrompt.factualWritingContract).toContain('future or conditional');
    expect(geoffreyWritingPrompt.factualWritingContract).toContain('Never convert a qualitative scale claim');
    expect(writingPrompt.verifiedSourceReactionContract.forbiddenAnalystMoves).toEqual(expect.arrayContaining([
      expect.stringContaining('private capital'),
      expect.stringContaining('category leadership'),
    ]));
    expect(writingPrompt.verifiedSourceReactionContract.factSelection).toContain('use only the one');
  });

  it('hard-rejects production-observed generated cadence without rejecting native anchors', () => {
    const rejectedProductionDrafts = [
      "liquidation cascade research keeps failing as a crash oracle. early-warning signals don't reproduce across events, seven BTC cascades and each looks different. real product is boring: sell adaptive margin and exposure controls to exchanges and MMs. stop promising traders the call.",
      'AI labs treat geopolitics like an annual ethics module while their deploy decisions, partnerships, and access controls are already moving international dynamics. the review belongs at the product decision, not the training slide.',
      'attestation is quietly becoming a procurement feature, not just a security primitive. encrypted CVMs can protect weights in use, but buyers still need proof the right hardware and stack actually ran their job. whoever turns that proof into policies and audit logs wins more than the exchange selling the machines.',
      "underdog selling to IG group tells you the real choke point in prediction markets isn't the app. it's the exchange + compliance stack. even the best consumer front end had to buy its way into regulated rails. every standalone prediction app should read that closely.",
      "boardy giving away deck reviews and meeting prep for free tells you those aren't the product. the product is remembering what you're working toward across every conversation. tasks are commodity, accumulated context is the moat.",
      "how many agent builders are actually classifying calls by latency sensitivity now that there's a fast tier? most workflow steps are delay-tolerant. blasting every token through premium speed is just burning money for vibes.",
      'corollary for founders: treat licensing and exchange access as the product, not a back-office chore. build it, partner for it, or acquire it early. a slick front end without owned rails is just a customer acquisition funnel for whoever controls clearing.',
      "if you want to diligence culture, skip the mission statement and ask about the last person who should've been let go and wasn't. founders reveal what they actually reward through who they keep. everything else is decoration.",
      'computer-use agents hit 85%. i\'m officially retiring "cool demo" from my vocabulary for this category.',
      "i'm genuinely moved by how fast this benchmark crossed humans.",
      'the benchmark is the one i keep coming back to.',
      'my take on openai: the valuation is the whole argument.',
      'my dream acquisition right now: openai buys linear.',
      'my litmus test for robotics companies going commercial: ask about reducers.',
      'owning OpenAI can be the status purchase and the investment at the same time. that is exactly when the price deserves more scrutiny, not less.',
    ];

    expect(rejectedProductionDrafts.every((draft) => getV2GeneratedWritingIssue(draft) !== null)).toBe(true);
    expect(GEOFFREY_NATIVE_EVAL.every((anchor) => getV2GeneratedWritingIssue(anchor) === null)).toBe(true);
    expect(getV2GeneratedWritingIssue('i think google should buy @cognition for $200b and make @ScottWu46 ceo')).toBeNull();
    expect(getV2GeneratedWritingIssue("i'd bet @cognition is worth $200b before most public software companies catch up")).toBeNull();
  });

  it('turns prior outcomes into compact strategy without leaking winning post copy', () => {
    const learningBrief = buildGenerationLearningBriefV2({
      manualTopicProfile: [{ topic: 'startups', angle: 'EXACT WINNING PREMISE', weight: 1, sampleCount: 5, avgEngagement: 39, topTweets: [] }],
      formatRankings: [{ format: 'announcement', avgEngagement: 36, count: 4 }, { format: 'analysis', avgEngagement: 13, count: 1 }],
      audienceSegmentPerformance: [{ segment: 'generalists', posts: 12, avgEngagement: 33, wins: 7 }],
      promptStrategyPerformance: [{ strategy: 'high_specificity', posts: 8, avgEngagement: 30, wins: 5 }],
      frontierForecastProfile: {
        version: 'frontier-forecast-learning-test',
        eligiblePosts: 12,
        forecastPosts: 8,
        directShareMetricCoverage: 0.75,
        aggressiveForecastShare: 0.625,
        exponentialMechanismShare: 0.5,
        winningPatterns: ['Horizon 6 12 months averages 0.82 relative spread across 4 posts (3 wins).'],
        avoidPatterns: ['Avoid overusing posture wish or request.'],
      },
      operatorVoiceReference: {
        styleFingerprint: {
          avgLength: 160,
          shortPct: 75,
          mediumPct: 25,
          longPct: 0,
          questionRatio: 25,
          usesLineBreaks: false,
          usesEmojis: false,
          usesNumbers: true,
          topHooks: ['observation', 'question'],
          topTones: ['casual', 'earnest'],
          antiPatterns: ['consultant cadence'],
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    } as any, {
      alwaysDoMoreOfThis: [
        'Use concrete operator evidence.',
        'Reuse the energy of: EXACT WINNING POST COPY',
        'Fallback lesson: provider template fallback drafts can survive approval.',
      ],
      neverDoThisAgain: ['Do not write generic AI advice.'],
      operatorHiddenPreferences: ['Stop after the point lands.'],
      identityConstraints: ['Avoid political drift.'],
    } as any);
    const prompt = JSON.parse(buildIdeaGenerationPromptV2([brief('operator', 'startups')], voiceProfile, [], learningBrief));

    expect(prompt.learnedEditorialStrategy).toMatchObject({
      provenTopics: [{ topic: 'startups', sampleCount: 5, avgEngagement: 39 }],
      winningFormats: [{ format: 'announcement', sampleCount: 4, avgEngagement: 36 }],
      winningAudiences: [expect.objectContaining({ audience: 'generalists', wins: 7 })],
      winningStrategies: [expect.objectContaining({ strategy: 'high_specificity', wins: 5 })],
      voiceMechanics: expect.objectContaining({ averageLength: 160, shortPercent: 75, questionPercent: 25 }),
      frontierForecast: expect.objectContaining({
        version: 'frontier-forecast-learning-test',
        aggressiveForecastShare: 0.625,
        exponentialMechanismShare: 0.5,
      }),
      doMore: expect.arrayContaining(['Use concrete operator evidence.', 'Stop after the point lands.']),
      avoid: expect.arrayContaining(['Do not write generic AI advice.', 'Avoid political drift.', 'consultant cadence']),
    });
    expect(JSON.stringify(prompt)).not.toContain('EXACT WINNING PREMISE');
    expect(JSON.stringify(prompt)).not.toContain('EXACT WINNING POST COPY');
    expect(JSON.stringify(prompt)).not.toContain('Fallback lesson');
  });

  it('uses stable shuffled pairwise ordering and pauses only after three consecutive system failures', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(orderV2IdsForPairwise(ids, 'idea')).toEqual(orderV2IdsForPairwise([...ids].reverse(), 'idea'));
    const at = new Date('2026-08-01T12:00:00.000Z');
    const failures = [
      run('failed', '2026-08-01T11:59:00.000Z'),
      run('failed', '2026-08-01T11:58:00.000Z'),
      run('failed', '2026-08-01T11:57:00.000Z'),
    ];
    expect(getGenerationV2CircuitPauseUntil(failures, at)).toBe('2026-08-01T13:59:00.000Z');
    expect(getGenerationV2CircuitPauseUntil([failures[0], run('empty', '2026-08-01T11:58:30.000Z'), ...failures.slice(1)], at)).toBeNull();
  });
});
