import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet, getQueuedTweets, getTweet, saveAnalysis } from '@/lib/kv-storage';
import {
  getPublishingV2FinalCriticVersion,
  getPublishingV2QualityPolicyVersion,
  PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
} from '@/lib/publishing-quality-policy';

const {
  buildGenerationContextMock,
  generatePublishingBatchV2Mock,
  getAgentAutomationEntitlementMock,
} = vi.hoisted(() => ({
  buildGenerationContextMock: vi.fn(),
  generatePublishingBatchV2Mock: vi.fn(),
  getAgentAutomationEntitlementMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, handle: 'remix-route-agent', name: 'Remix Agent', soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: buildGenerationContextMock,
}));

vi.mock('@/lib/publishing-v2', () => ({
  generatePublishingBatchV2: generatePublishingBatchV2Mock,
}));

vi.mock('@/lib/automation-entitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement');
  return {
    ...actual,
    getAgentAutomationEntitlement: getAgentAutomationEntitlementMock,
  };
});

import { POST } from '@/app/api/agents/[id]/remix/route';

function makeAnalysis(agentId: string) {
  return {
    agentId,
    analyzedAt: new Date().toISOString(),
    tweetCount: 10,
    viralTweets: [],
    engagementPatterns: {
      avgLikes: 10,
      avgRetweets: 2,
      avgReplies: 1,
      avgImpressions: 500,
      topHours: [14],
      topFormats: ['hot_take'],
      topTopics: ['AI'],
      viralThreshold: 30,
    },
    followingProfile: { totalFollowing: 10, topAccounts: [], categories: [] },
    contentFingerprint: 'fingerprint',
  };
}

const evidence = [{
  sourceDocumentId: 'source-remix',
  url: 'https://example.com/source',
  title: 'Source',
  publisher: 'Example',
  publishedAt: new Date().toISOString(),
  trustTier: 'primary' as const,
  claim: 'Evidence for the parent draft.',
}];

async function createV2Parent(agentId: string, status: 'queued' | 'draft') {
  return createTweet({
    agentId,
    content: 'Support queues shrink when the exception log is read every morning.',
    type: 'original',
    status,
    topic: 'operations',
    pipelineVersion: 'v2',
    contentProvenance: 'generated_v2',
    generationSurface: 'original',
    generationRunId: 'run-parent',
    ideaId: 'idea-parent',
    draftCandidateId: `draft-parent-${status}`,
    qualityPolicyVersion: getPublishingV2QualityPolicyVersion('original'),
    voiceCorpusVersion: 'voice-corpus-test',
    finalCriticVersion: getPublishingV2FinalCriticVersion('original'),
    finalCriticVerdict: 'allow',
    finalCriticProvider: 'openai',
    finalCriticModel: 'test-critic',
    finalCriticScores: { qualityMargin: PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN + 0.05 },
    evidenceReferences: evidence,
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
  } as any);
}

function remixCandidate(draftCandidateId: string, parentTweetId: string) {
  return {
    parentTweetId,
    content: 'Read the exception log every morning and the support queue shrinks.',
    format: 'hot_take',
    targetTopic: 'operations',
    rationale: 'shorter',
    pipelineVersion: 'v2',
    generationSurface: 'remix',
    contentProvenance: 'generated_v2',
    generationRunId: 'run-remix',
    ideaId: 'idea-parent',
    draftCandidateId,
    evidenceReferences: evidence,
    generationMode: 'balanced',
    candidateScore: 80,
    confidenceScore: 0.7,
    voiceScore: 0.7,
    noveltyScore: 0.7,
    predictedEngagementScore: 0.7,
    freshnessScore: 0.6,
    repetitionRiskScore: 0.1,
    policyRiskScore: 0.1,
  };
}

function remixRequest(body: string): Request {
  return new Request('http://localhost/api/remix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('remix route lineage', () => {
  beforeEach(() => {
    buildGenerationContextMock.mockReset();
    generatePublishingBatchV2Mock.mockReset();
    getAgentAutomationEntitlementMock.mockReset();
    buildGenerationContextMock.mockResolvedValue({
      voiceProfile: { tone: 'direct', topics: ['operations'], antiGoals: [], communicationStyle: 'plain', summary: 'summary' },
      learnings: null,
      style: { lengthMix: { short: 30, medium: 40, long: 30 }, enabledFormats: ['hot_take'], autonomyMode: 'balanced' },
      recentPosts: [],
      allTweets: [],
      memory: null,
      signals: [],
    });
    getAgentAutomationEntitlementMock.mockResolvedValue({
      source: 'agent_exemption',
      eligible: true,
      reason: 'test exemption',
      verifiedAt: new Date().toISOString(),
      paidThrough: null,
      paidInvoiceId: null,
      paidAmountCents: null,
      paidCurrency: null,
    });
  });

  it('supersedes a queued parent: the child is queued and the parent is quarantined', async () => {
    const agent = await createAgent({ handle: 'remix-route-agent', name: 'Remix Agent', soulMd: '# soul' } as any);
    await saveAnalysis(agent.id, makeAnalysis(agent.id));
    const parent = await createV2Parent(agent.id, 'queued');
    generatePublishingBatchV2Mock.mockResolvedValueOnce([remixCandidate('draft-remix-queued', parent.id)]);

    const response = await POST(
      remixRequest(JSON.stringify({ tweetId: parent.id, direction: 'shorter' })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.supersededParent).toBe(true);
    expect(data.parentTweetId).toBe(parent.id);
    expect(data.content).toBe(data.tweet.content);
    expect(data.tweet.status).toBe('queued');
    expect(data.tweet.parentTweetId).toBe(parent.id);

    const storedParent = await getTweet(parent.id);
    expect(storedParent?.status).toBe('quarantined');
    expect(storedParent?.preQuarantineStatus).toBe('queued');
    expect(storedParent?.quarantineReason).toBe(`Superseded by remix child ${data.tweet.id}.`);

    const queuedIds = (await getQueuedTweets(agent.id)).map((tweet) => tweet.id);
    expect(queuedIds).toContain(data.tweet.id);
    expect(queuedIds).not.toContain(parent.id);
  });

  it('leaves a draft parent untouched and creates a draft child', async () => {
    const agent = await createAgent({ handle: 'remix-route-draft-agent', name: 'Remix Agent', soulMd: '# soul' } as any);
    await saveAnalysis(agent.id, makeAnalysis(agent.id));
    const parent = await createV2Parent(agent.id, 'draft');
    generatePublishingBatchV2Mock.mockResolvedValueOnce([remixCandidate('draft-remix-draft', parent.id)]);

    const response = await POST(
      remixRequest(JSON.stringify({ tweetId: parent.id, direction: 'shorter' })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.supersededParent).toBe(false);
    expect(data.tweet.status).toBe('draft');
    expect((await getTweet(parent.id))?.status).toBe('draft');
  });

  it('answers 400 for a malformed JSON body', async () => {
    const agent = await createAgent({ handle: 'remix-route-json-agent', name: 'Remix Agent', soulMd: '# soul' } as any);

    const response = await POST(
      remixRequest('{') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid JSON body');
  });
});
