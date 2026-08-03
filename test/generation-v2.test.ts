import { describe, expect, it } from 'vitest';
import {
  buildGenerationBriefsV2,
  buildGenerationLearningBriefV2,
  buildIdeaGenerationPromptV2,
  buildTweetWritingPromptV2,
  getGenerationV2CircuitPauseUntil,
  getV2GeneratedWritingIssue,
  isStoryEditoriallyQualifiedV2,
  normalizeIdeaCandidatesV2,
  orderV2IdsForPairwise,
  type GenerationBriefV2,
} from '@/lib/generation-v2';
import { buildResearchSemanticKey } from '@/lib/research-utils';
import type { GenerationRunTrace, IdeaCandidate, SemanticBlock, SourceDocument, StoryCluster } from '@/lib/types';
import { GEOFFREY_NATIVE_EVAL } from './fixtures/geoffrey-quality-eval';

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

describe('Tweet Generation V2', () => {
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
    const ideaPrompt = JSON.parse(buildIdeaGenerationPromptV2([currentBrief], voiceProfile));
    const writingPrompt = JSON.parse(buildTweetWritingPromptV2(idea, currentBrief, [source], [{
      id: 'operator-post-1', content: 'the market usually tells you where the bottleneck moved', topic: 'markets',
    }]));

    expect(ideaPrompt.requirements.ideasPerBrief).toBe(3);
    expect(writingPrompt).toEqual(expect.objectContaining({
      idea: expect.objectContaining({ claim: idea.claim }),
      evidenceMode: 'verified_source',
      evidence: [expect.objectContaining({ sourceDocumentId: 'source-sourced' })],
      voiceAnchors: [expect.objectContaining({
        id: 'operator-post-1',
        instruction: expect.stringContaining('Diction and rhythm evidence only'),
      })],
    }));
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
    ];

    expect(rejectedProductionDrafts.every((draft) => getV2GeneratedWritingIssue(draft) !== null)).toBe(true);
    expect(GEOFFREY_NATIVE_EVAL.every((anchor) => getV2GeneratedWritingIssue(anchor) === null)).toBe(true);
  });

  it('turns prior outcomes into compact strategy without leaking winning post copy', () => {
    const learningBrief = buildGenerationLearningBriefV2({
      manualTopicProfile: [{ topic: 'startups', angle: 'EXACT WINNING PREMISE', weight: 1, sampleCount: 5, avgEngagement: 39, topTweets: [] }],
      formatRankings: [{ format: 'announcement', avgEngagement: 36, count: 4 }, { format: 'analysis', avgEngagement: 13, count: 1 }],
      audienceSegmentPerformance: [{ segment: 'generalists', posts: 12, avgEngagement: 33, wins: 7 }],
      promptStrategyPerformance: [{ strategy: 'high_specificity', posts: 8, avgEngagement: 30, wins: 5 }],
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
