import { describe, expect, it } from 'vitest';
import { updateTweet } from '@/lib/kv-storage';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';

describe('generated tweet persistence', () => {
  it('preserves generation, judge, corpus, and final-critic provenance', async () => {
    const tweet = await createTweetFromGeneratedCandidate(`agent-provenance-${Date.now()}`, {
      content: 'inference economics get interesting when memory bandwidth, not flops, sets the serving margin',
      format: 'hot_take',
      targetTopic: 'inference asics',
      rationale: 'A compressed technical startup consequence.',
      generationModelStack: 'geoffrey_fable5_gpt56',
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
    } as any, { status: 'preview' });

    expect(tweet).toMatchObject({
      generationModelStack: 'geoffrey_fable5_gpt56',
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
    });

    const edited = await updateTweet(tweet.id, {
      content: `${tweet.content}. edited by the operator`,
    });
    expect(edited).toMatchObject({
      generationModelStack: 'geoffrey_fable5_gpt56',
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
});
