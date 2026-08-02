import { describe, expect, it } from 'vitest';
import {
  buildGenerationBriefsV2,
  buildIdeaGenerationPromptV2,
  buildTweetWritingPromptV2,
  getGenerationV2CircuitPauseUntil,
  normalizeIdeaCandidatesV2,
  orderV2IdsForPairwise,
  type GenerationBriefV2,
} from '@/lib/generation-v2';
import { buildResearchSemanticKey } from '@/lib/research-utils';
import type { GenerationRunTrace, IdeaCandidate, SemanticBlock, SourceDocument, StoryCluster } from '@/lib/types';

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
