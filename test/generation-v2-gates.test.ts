import { describe, expect, it } from 'vitest';
import {
  buildIdeaGenerationPromptV2,
  buildTweetWritingPromptV2,
  buildVoiceGuidanceV2,
  getV2GeneratedWritingIssue,
  isOperatorPremiseReskinV2,
  selectQuestionBudgetDemotionsV2,
  usesGeoffreyRegisterFloorsV2,
  V2_LEARNED_PRIOR_SELECTION_WEIGHT,
  V2_VIRALITY_SELECTION_WEIGHT,
  type GenerationBriefV2,
} from '@/lib/generation-v2';
import { scoreSlopRisk } from '@/lib/virality-signals';
import { extractCandidateFeatureTags } from '@/lib/tweet-features';
import type { IdeaCandidate } from '@/lib/types';

const coachProfile = {
  tone: 'warm and direct',
  topics: ['strength training', 'sleep', 'coaching'],
  antiGoals: ['Never sell supplements', 'Avoid shaming people'],
  communicationStyle: 'short lived-in coaching notes',
  summary: 'A strength coach who writes about training, sleep, and client progress.',
};

const geoffreyProfile = {
  tone: 'casual and direct',
  topics: ['AI startups', 'founders'],
  antiGoals: [],
  communicationStyle: 'short operator observations',
  summary: 'A founder and investor. Account topic policy for @geoffwoo.',
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

function idea(briefId: string, topic: string, publicMove: string): IdeaCandidate {
  return {
    id: `idea-${briefId}`,
    briefId,
    storyClusterId: null,
    topic,
    publicMove,
    claim: publicMove,
    tension: 'The obvious read is wrong.',
    implication: 'Orgs shrink faster than budgets adjust.',
    counterargument: null,
    evidenceIds: [],
  } as unknown as IdeaCandidate;
}

const longCommunicationStyle = [
  'short lived-in coaching notes',
  `## RECENT OPERATOR REJECTIONS (avoid similar content)\n${Array.from({ length: 5 }, (_, index) => `- "rejected draft ${index} about generic motivation"`).join('\n')}`,
  `## OPERATOR VOICE REFERENCE (manual/operator-written tweets are high-signal)\nDerived from 10 manually posted tweets.\nVoice anchors:\n${Array.from({ length: 10 }, (_, index) => `- "${'x'.repeat(170)} anchor ${index}"`).join('\n')}\nUse these as VOICE calibration examples.`,
  '## OPERATOR VOICE DIRECTIVES (permanent rules from coaching — follow these)\n1. Never recommend a supplement brand.\n2. Always name the client outcome before the method.\nNote: If any directives seem contradictory, prefer the MORE RECENT ones (higher numbers).',
].join('\n\n');

describe('generation-v2 gate and prompt fixes', () => {
  it('tiers premise similarity on precise buckets so broad vocabulary never crosses a hard reject alone', () => {
    // team_headcount + benchmark_shipping (broad) + timing_survival (precise)
    expect(isOperatorPremiseReskinV2(
      'a tiny team should wait on the deal and build instead',
      ['the team scaled too fast and timing killed it; they were building the wrong thing'],
    )).toBe(false);
    // Three precise buckets still hard-reject.
    expect(isOperatorPremiseReskinV2(
      'the margin agreement and leverage killed that trade before the market ever moved, a total collapse',
      ['he scaled too fast with leverage and got liquidated by timing; the downfall was brutal'],
    )).toBe(true);
    // Two precise buckets keep rejecting regardless of extra broad overlap.
    expect(isOperatorPremiseReskinV2(
      'the team margin agreement killed that trade before the market ever moved',
      ['his team scaled too fast with leverage and got liquidated by timing'],
    )).toBe(true);
  });

  it('applies the slop hard gate at the same boundary as the final gate', () => {
    const boundary = 'Leverage is a moat. Unlock it when the metric moves after the eval.';
    expect(scoreSlopRisk(boundary, extractCandidateFeatureTags(boundary))).toBe(0.32);
    expect(getV2GeneratedWritingIssue(boundary)).toContain('0.320');
    expect(getV2GeneratedWritingIssue('i think google should buy @cognition for $200b and make @ScottWu46 ceo')).toBeNull();
  });

  it('demotes merged question overflow by the selection key, not confidence', () => {
    const selected = [
      {
        content: 'is every startup now a race to reserve capacity before customers commit?',
        confidenceScore: 0.8,
        judgeBreakdown: { qualityMargin: 0.9, viralityUpside: 0.7 },
      },
      {
        content: 'plain observation about capacity.',
        confidenceScore: 0.9,
        judgeBreakdown: { qualityMargin: 0.95, viralityUpside: 0.1 },
      },
      {
        content: 'should founders sign the capacity deal before the first paying customer?',
        confidenceScore: 0.84,
        judgeBreakdown: { qualityMargin: 0.86, viralityUpside: 0.3 },
      },
    ] as any;
    expect(selectQuestionBudgetDemotionsV2(selected, 1)).toEqual([2]);
    expect(selectQuestionBudgetDemotionsV2(selected, 2)).toEqual([]);
    expect(selectQuestionBudgetDemotionsV2(selected, 0)).toEqual([0, 2]);
    const firstKey = 0.9 + 0.7 * V2_VIRALITY_SELECTION_WEIGHT;
    const thirdKey = 0.86 + 0.3 * V2_VIRALITY_SELECTION_WEIGHT;
    expect(firstKey).toBeGreaterThan(thirdKey);
    // Ties fall back to selection order.
    const tied = selected.map((entry: any) => ({ ...entry, judgeBreakdown: { qualityMargin: 0.9, viralityUpside: 0.2 } }));
    expect(selectQuestionBudgetDemotionsV2(tied, 1)).toEqual([2]);
  });

  it('scopes the casual-startup and stiffness floors to the Geoffrey register', () => {
    expect(usesGeoffreyRegisterFloorsV2(geoffreyProfile)).toBe(true);
    expect(usesGeoffreyRegisterFloorsV2(coachProfile)).toBe(false);
    expect(usesGeoffreyRegisterFloorsV2(null)).toBe(false);
  });

  it('splits learned voice sections out of communicationStyle and trims raw prose before directives', () => {
    const full = buildVoiceGuidanceV2({ communicationStyle: longCommunicationStyle }, { budget: 6000, includeRawProse: true });
    expect(full.baseStyle).toBe('short lived-in coaching notes');
    expect(full.learnedSections.map((section) => section.heading.split(' (')[0])).toEqual([
      'OPERATOR VOICE DIRECTIVES',
      'OPERATOR VOICE REFERENCE',
      'RECENT OPERATOR REJECTIONS',
    ]);
    expect(full.learnedSections[0].body).toContain('Always name the client outcome before the method.');
    expect(full.learnedSections[0].body).toContain('prefer the MORE RECENT ones');
    expect(full.droppedSections).toEqual([]);

    const tight = buildVoiceGuidanceV2({ communicationStyle: longCommunicationStyle }, { budget: 400, includeRawProse: true });
    expect(tight.learnedSections.map((section) => section.heading.split(' (')[0])).toEqual(['OPERATOR VOICE DIRECTIVES']);
    expect(tight.learnedSections[0].body).toContain('Never recommend a supplement brand.');
    expect(tight.droppedSections.map((heading) => heading.split(' (')[0])).toEqual([
      'OPERATOR VOICE REFERENCE',
      'RECENT OPERATOR REJECTIONS',
    ]);

    const ideation = buildVoiceGuidanceV2({ communicationStyle: longCommunicationStyle }, { budget: 6000, includeRawProse: false });
    expect(ideation.learnedSections.map((section) => section.heading.split(' (')[0])).toEqual(['OPERATOR VOICE DIRECTIVES']);
    expect(JSON.stringify(ideation)).not.toContain('anchor 3');
    expect(JSON.stringify(ideation)).not.toContain('rejected draft');
  });

  it('carries directives and anti-goals into idea and writer prompts without Geoffrey identity for other accounts', () => {
    const profile = { ...coachProfile, communicationStyle: longCommunicationStyle };
    const ideaPrompt = JSON.parse(buildIdeaGenerationPromptV2([brief('operator', 'sleep', 'verified_source')], profile));
    expect(ideaPrompt.author.antiGoals).toEqual(['Never sell supplements', 'Avoid shaming people']);
    expect(ideaPrompt.author.communicationStyle).toBe('short lived-in coaching notes');
    expect(JSON.stringify(ideaPrompt.author.learnedVoiceGuidance)).toContain('Always name the client outcome before the method.');
    expect(JSON.stringify(ideaPrompt.author.learnedVoiceGuidance)).not.toContain('anchor 3');
    expect(JSON.stringify(ideaPrompt)).not.toContain('Geoffrey');
    expect(ideaPrompt.requirements.verifiedSourceReactionContract).toContain('high-context reaction can be complete');

    const writerPrompt = JSON.parse(buildTweetWritingPromptV2(
      idea('operator', 'sleep', 'i would fix sleep before adding a fourth training day'),
      brief('operator', 'sleep', 'verified_source'),
      [],
      [],
      undefined,
      undefined,
      undefined,
      'reconceive',
      3,
      null,
      false,
      profile,
    ));
    expect(writerPrompt.author.antiGoals).toEqual(['Never sell supplements', 'Avoid shaming people']);
    expect(JSON.stringify(writerPrompt.author.learnedVoiceGuidance)).toContain('Never recommend a supplement brand.');
    expect(JSON.stringify(writerPrompt.author.learnedVoiceGuidance)).toContain('prefer the MORE RECENT ones');
    expect(JSON.stringify(writerPrompt)).not.toContain('Geoffrey');
    expect(writerPrompt.verifiedSourceReactionContract.publicMove).not.toContain('next-12-month forecast');
    expect(writerPrompt.responseContract.variantMoves[0].instruction).toContain('Do not add the consequence in this slot');

    const geoffreyPrompt = JSON.parse(buildIdeaGenerationPromptV2([brief('operator', 'sleep', 'verified_source')], geoffreyProfile));
    expect(geoffreyPrompt.requirements.verifiedSourceReactionContract).toContain('plain high-context reaction can be complete');
    expect(JSON.parse(buildTweetWritingPromptV2(
      idea('operator', 'sleep', 'i would fix sleep first'),
      brief('operator', 'sleep'),
      [],
      [],
    )).author).toBeNull();
  });

  it('serves proven spread mechanics as positive references outside previousPremises', () => {
    const prompt = JSON.parse(buildIdeaGenerationPromptV2(
      [brief('operator', 'sleep')],
      coachProfile,
      ['{"source":"generated_post","semanticKey":"client:deadlift:sleep"}'],
      undefined,
      [],
      [],
      [],
      {},
      [{ source: 'performance_outcome', spreadMechanics: ['concrete before/after contrast'] }],
    ));
    expect(JSON.stringify(prompt.previousPremises)).not.toContain('performance_outcome');
    expect(prompt.provenSpreadMechanics).toEqual({
      instruction: expect.stringContaining('not premises to avoid'),
      references: [{ source: 'performance_outcome', spreadMechanics: ['concrete before/after contrast'] }],
    });
    expect(JSON.parse(buildIdeaGenerationPromptV2([brief('operator', 'sleep')], coachProfile)).provenSpreadMechanics).toBeNull();
  });

  it('keeps timed Geoffrey AI variants singular instead of exposing the whole rubric', () => {
    const aiIdea = idea(
      'operator',
      'OpenAI coding agents',
      'i think within 12 months OpenAI coding agents will make tiny orgs the default once each model cycle cuts required capacity',
    );
    const lanePrompt = JSON.parse(buildTweetWritingPromptV2(
      aiIdea,
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
      geoffreyProfile,
    ));
    expect(lanePrompt.geoffreyAIFutureHorizon).not.toBeNull();
    const laneInstructions = lanePrompt.responseContract.variantMoves.map((move: any) => move.instruction).join(' ');
    expect(laneInstructions).toContain('Do not add a mechanism or consequence in this slot');
    expect(laneInstructions).toContain('at most one mechanism');
    expect(laneInstructions).toContain('exactly one consequence');
    expect(lanePrompt.responseContract.variantMoves.map((move: any) => move.consequenceRole)).toEqual([
      'reaction_only',
      'reaction_only',
      'approved_consequence',
    ]);
    expect(lanePrompt.responseContract.diversityContract).toContain('Never combine all three');

    const singleLanePrompt = JSON.parse(buildTweetWritingPromptV2(
      aiIdea,
      brief('operator', 'OpenAI coding agents'),
      [],
      [],
      undefined,
      undefined,
      undefined,
      'reconceive',
      1,
      null,
      false,
      geoffreyProfile,
    ));
    expect(singleLanePrompt.responseContract.variantMoves[0].instruction).toContain('at most one mechanism or consequence');

    const otherLanePrompt = JSON.parse(buildTweetWritingPromptV2(
      idea('operator', 'founder financing', 'i would take the smaller round from the founder who already has a customer'),
      brief('operator', 'founder financing'),
      [],
      [],
      undefined,
      undefined,
      undefined,
      'reconceive',
      3,
      null,
      false,
      geoffreyProfile,
    ));
    expect(otherLanePrompt.geoffreyAIFutureHorizon).toBeNull();
    expect(otherLanePrompt.responseContract.variantMoves[0].instruction).toContain('Do not add the consequence in this slot');
    expect(otherLanePrompt.responseContract.variantMoves[1].instruction).toContain('Stop at the direct reaction');
    expect(otherLanePrompt.responseContract.diversityContract).toContain('Slot 1 is the bare spoken verdict');
  });
});

describe('learned outcome prior in the shared selection key', () => {
  it('breaks a quality tie toward the arms this account has actually measured', () => {
    // Same margin and upside; only the measured-outcome prior differs, so the
    // draft on the account's proven arms must outrank the one on arms that
    // measured badly, and the untested draft must sit between them.
    const selected = [
      { content: 'Is the queue the bottleneck?', judgeBreakdown: { qualityMargin: 0.9, viralityUpside: 0.4, learnedArmPrior: -0.8 } },
      { content: 'Is the model the bottleneck?', judgeBreakdown: { qualityMargin: 0.9, viralityUpside: 0.4, learnedArmPrior: 0 } },
      { content: 'Is the reviewer the bottleneck?', judgeBreakdown: { qualityMargin: 0.9, viralityUpside: 0.4, learnedArmPrior: 0.8 } },
    ] as any;

    // With one question allowed, the two weaker-priored drafts are demoted and
    // the proven one survives.
    expect(selectQuestionBudgetDemotionsV2(selected, 1)).toEqual([0, 1]);
    // With two allowed, only the arm that measured badly is demoted.
    expect(selectQuestionBudgetDemotionsV2(selected, 2)).toEqual([0]);
  });

  it('keeps the learned prior a tie-breaker rather than a gate override', () => {
    // A full-strength negative prior must not outweigh a clear quality gap.
    const clearQualityGap = 0.2;
    expect(clearQualityGap).toBeGreaterThan(1 * V2_LEARNED_PRIOR_SELECTION_WEIGHT);
    const selected = [
      { content: 'Is the queue the bottleneck?', judgeBreakdown: { qualityMargin: 0.9, viralityUpside: 0, learnedArmPrior: -1 } },
      { content: 'Is the model the bottleneck?', judgeBreakdown: { qualityMargin: 0.7, viralityUpside: 0, learnedArmPrior: 1 } },
    ] as any;
    expect(selectQuestionBudgetDemotionsV2(selected, 1)).toEqual([1]);
  });

  it('weights measured history in the same small band as the viral-upside bonus', () => {
    expect(V2_LEARNED_PRIOR_SELECTION_WEIGHT).toBeGreaterThan(0);
    expect(V2_LEARNED_PRIOR_SELECTION_WEIGHT).toBeLessThanOrEqual(V2_VIRALITY_SELECTION_WEIGHT);
  });
});
