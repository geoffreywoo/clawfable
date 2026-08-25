import { describe, expect, it } from 'vitest';
import { getTweets, updateTweet } from '@/lib/kv-storage';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';

describe('generated tweet persistence', () => {
  it('preserves generation, judge, corpus, and final-critic provenance', async () => {
    const tweet = await createTweetFromGeneratedCandidate(`agent-provenance-${Date.now()}`, {
      content: 'inference economics get interesting when memory bandwidth, not flops, sets the serving margin',
      format: 'hot_take',
      targetTopic: 'inference asics',
      rationale: 'A compressed technical startup consequence.',
      generationModelStack: 'publishing_v2_quality',
      generationProvider: 'anthropic',
      generationModel: 'claude-fable-5',
      judgeProvider: 'anthropic',
      judgeModel: 'claude-opus-4-6',
      qualityPolicyVersion: 'geoffwoo-quality-v9',
      voiceCorpusVersion: 'voice-corpus-v1-current',
      finalCriticProvider: 'openai',
      finalCriticModel: 'gpt-5.6',
      finalCriticVerdict: 'allow',
      finalCriticScores: {
        voiceFit: 0.82,
        nativeVoice: 0.8,
        casualStartupFit: 0.72,
        technicalCredibility: 0.78,
        cringeRisk: 0.08,
        stiffnessRisk: 0.12,
      },
      finalCriticVersion: 'geoffwoo-final-critic-v1',
      pipelineVersion: 'v2',
      generationRunId: 'run-v2-provenance',
      storyClusterId: 'story-v2-provenance',
      ideaId: 'idea-v2-provenance',
      draftCandidateId: 'draft-v2-provenance',
      evidenceReferences: [{
        sourceDocumentId: 'source-v2-provenance',
        url: 'https://example.com/evidence',
        title: 'Inference economics release',
        publisher: 'Example Labs',
        publishedAt: '2026-08-01T00:00:00.000Z',
        trustTier: 'primary',
        claim: 'Memory bandwidth sets the serving constraint.',
      }],
      portfolioCompanyContext: {
        policyVersion: 'antifund-portfolio-alignment-1',
        snapshotVersion: 'antifund-portfolio-2026-08-21',
        snapshotExpiresAt: '2026-11-19T00:00:00.000Z',
        companyId: 'etched',
        companyName: 'Etched',
        companyUrl: 'https://www.etched.com/',
        category: 'ai_infrastructure_national_resilience',
        description: 'Purpose-built chips for transformer inference.',
        sportsAdjacent: false,
        relationship: 'antifund_selected_investment',
        intent: 'live_development',
        sourceUrl: 'https://antifund.com/#portfolio',
      },
      allowedMentionHandles: ['etched'],
    } as any, { status: 'preview' });

    expect(tweet).toMatchObject({
      generationModelStack: 'publishing_v2_quality',
      generationProvider: 'anthropic',
      generationModel: 'claude-fable-5',
      judgeProvider: 'anthropic',
      judgeModel: 'claude-opus-4-6',
      qualityPolicyVersion: 'geoffwoo-quality-v9',
      voiceCorpusVersion: 'voice-corpus-v1-current',
      finalCriticProvider: 'openai',
      finalCriticModel: 'gpt-5.6',
      finalCriticVerdict: 'allow',
      finalCriticVersion: 'geoffwoo-final-critic-v1',
      finalCriticScores: expect.objectContaining({ nativeVoice: 0.8 }),
      pipelineVersion: 'v2',
      generationRunId: 'run-v2-provenance',
      storyClusterId: 'story-v2-provenance',
      ideaId: 'idea-v2-provenance',
      draftCandidateId: 'draft-v2-provenance',
      evidenceReferences: [expect.objectContaining({ sourceDocumentId: 'source-v2-provenance' })],
      portfolioCompanyContext: expect.objectContaining({ companyId: 'etched' }),
      allowedMentionHandles: ['etched'],
    });

    const edited = await updateTweet(tweet.id, {
      content: `${tweet.content}. edited by the operator`,
    });
    expect(edited).toMatchObject({
      generationModelStack: 'publishing_v2_quality',
      generationProvider: 'anthropic',
      generationModel: 'claude-fable-5',
      qualityPolicyVersion: null,
      voiceCorpusVersion: null,
      judgeProvider: null,
      judgeModel: null,
      finalCriticProvider: null,
      finalCriticModel: null,
      finalCriticVerdict: null,
      finalCriticVersion: null,
      pipelineVersion: 'v2',
      generationRunId: 'run-v2-provenance',
      ideaId: 'idea-v2-provenance',
      draftCandidateId: 'draft-v2-provenance',
    });
  });

  it('maps one generated draft candidate to one tweet across delivery retries', async () => {
    const agentId = `agent-idempotent-${Date.now()}`;
    const candidate = {
      content: 'same qualified artifact',
      format: 'observation',
      targetTopic: 'publishing',
      pipelineVersion: 'v2',
      generationSurface: 'reply',
      generationIdempotencyKey: 'publish-v2-same-request',
      contentProvenance: 'generated_v2',
      generationRunId: 'run-idempotent',
      ideaId: 'idea-idempotent',
      draftCandidateId: 'draft-idempotent',
    } as any;

    const first = await createTweetFromGeneratedCandidate(agentId, candidate, { status: 'draft', type: 'reply' });
    const second = await createTweetFromGeneratedCandidate(agentId, candidate, { status: 'draft', type: 'reply' });

    expect(second.id).toBe(first.id);
    expect((await getTweets(agentId)).filter((tweet) => tweet.draftCandidateId === candidate.draftCandidateId)).toHaveLength(1);
  });
});
