import { describe, expect, it } from 'vitest';
import {
  buildFailedStoryAttemptsV2,
  buildGenerationBriefsV2,
  buildGenerationLearningBriefV2,
  buildGenerationWritingConstraintsV2,
  buildIdeaGenerationPromptV2,
  buildTweetWritingPromptV2,
  getGenerationV2CircuitPauseUntil,
  getV2GeneratedWritingIssue,
  isQuestionDraftV2,
  isStoryAlreadyCommittedV2,
  isStoryInEditorialCooldownV2,
  isStoryEditoriallyQualifiedV2,
  normalizeIdeaCandidatesV2,
  normalizeDraftContentV2,
  orderV2IdsForPairwise,
  type GenerationBriefV2,
} from '@/lib/generation-v2';
import { buildResearchSemanticKey } from '@/lib/research-utils';
import {
  classifyGeoffreyTopicDomain,
  isGeoffreyDeepTechnicalTopic,
  isGeoffreyManufacturingMaterialsTopic,
} from '@/lib/source-planner';
import type { GenerationRunTrace, IdeaCandidate, SemanticBlock, SourceDocument, StoryCluster, Tweet } from '@/lib/types';
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
  it('preserves native paragraph rhythm while normalizing draft whitespace', () => {
    expect(normalizeDraftContentV2('  first beat  \r\n\r\n  second   beat  ')).toBe('first beat\n\nsecond beat');
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
        isPrimarySource: false,
        topTweet: { id: 'network-post-1', text: headline, likes: 900, author: 'builder' },
      } as any],
      allTweets: [],
    });

    const signal = briefs.find((entry) => entry.trendTopicId === 'network-openai-consumer-agent');
    expect(signal).toMatchObject({
      topic: 'OpenAI in ai compute',
      evidenceMode: 'operator_opinion',
      evidence: [],
      sourceDocumentIds: [],
    });
    expect(JSON.stringify(signal)).not.toContain('secret checkout workflow');
    expect(signal?.sourceBrief).toContain('Subject cue only');
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

    const subjects = briefs.map((entry) => `${entry.topic} ${entry.title}`);
    expect(briefs).toHaveLength(8);
    expect(subjects.filter(isGeoffreyDeepTechnicalTopic).length).toBeLessThanOrEqual(1);
    expect(subjects.filter(isGeoffreyManufacturingMaterialsTopic).length).toBeLessThanOrEqual(1);
    const domainCounts = subjects.reduce((counts, subject) => {
      const domain = classifyGeoffreyTopicDomain(subject);
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
    expect(isStoryEditoriallyQualifiedV2({
      ...qualified,
      id: 'story-range-filing',
      title: 'SCHEDULE 13G/A - Range Capital Management LP (Subject)',
      scores: { ...qualified.scores, consequence: 0.48 },
    })).toBe(false);
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

  it('does not carry failed-story cooldown across quality policy versions', () => {
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

    expect(buildFailedStoryAttemptsV2(
      failedIdeas,
      new Date('2026-08-13T00:00:00.000Z'),
      'publishing-v2-hard-gates-current',
    )).toHaveLength(0);
    expect(buildFailedStoryAttemptsV2(
      failedIdeas,
      new Date('2026-08-13T00:00:00.000Z'),
      'publishing-v2-hard-gates-old',
    )).toHaveLength(1);
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
    const ideaPrompt = JSON.parse(buildIdeaGenerationPromptV2([currentBrief], voiceProfile));
    const writingPrompt = JSON.parse(buildTweetWritingPromptV2(idea, currentBrief, [source], [{
      id: 'operator-post-1', content: 'the market usually tells you where the bottleneck moved', topic: 'markets',
    }]));

    expect(ideaPrompt.requirements.ideasPerBrief).toBe(3);
    expect(ideaPrompt.requirements.evidenceIdContract).toContain('not individual claims');
    expect(ideaPrompt.requirements.operatorOpinionContract).toContain('personal judgments, questions, predictions');
    expect(ideaPrompt.requirements.subjectContract).toContain('concrete subject');
    expect(ideaPrompt.briefs[0].evidence).toEqual([expect.objectContaining({
      evidenceId: 'source-sourced',
      claim: expect.any(String),
    })]);
    expect(ideaPrompt.briefs[0].evidence[0]).not.toHaveProperty('claimId');
    expect(ideaPrompt.briefs[0].evidence[0]).not.toHaveProperty('sourceDocumentId');
    expect(writingPrompt).toEqual(expect.objectContaining({
      idea: expect.objectContaining({ claim: idea.claim }),
      evidenceMode: 'verified_source',
      subjectContext: expect.objectContaining({
        title: 'AI infrastructure',
        instruction: expect.stringContaining('reason to publish now'),
      }),
      factualWritingContract: expect.stringContaining('directly supported'),
      evidence: [expect.objectContaining({ sourceDocumentId: 'source-sourced' })],
      voiceAnchors: [expect.objectContaining({
        id: 'operator-post-1',
        instruction: expect.stringContaining('Diction and rhythm evidence only'),
      })],
    }));

    const operatorWritingPrompt = JSON.parse(buildTweetWritingPromptV2(
      { ...idea, briefId: 'operator', storyClusterId: null, evidenceIds: [] },
      brief('operator', 'startups'),
      [],
      [],
    ));
    expect(operatorWritingPrompt.factualWritingContract).toContain('personal judgment, question, prediction');
    expect(operatorWritingPrompt.factualWritingContract).toContain('cannot present a current or historical event');
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
