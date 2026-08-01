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
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      judgeProvider: 'anthropic',
      judgeModel: 'claude-opus-4-6',
      qualityPolicyVersion: 'geoffwoo-quality-v2',
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
    } as any, { status: 'preview' });

    expect(tweet).toMatchObject({
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      judgeProvider: 'anthropic',
      judgeModel: 'claude-opus-4-6',
      qualityPolicyVersion: 'geoffwoo-quality-v2',
      voiceCorpusVersion: 'voice-corpus-v1-current',
      finalCriticProvider: 'openai',
      finalCriticModel: 'gpt-5.6',
      finalCriticVerdict: 'allow',
      finalCriticVersion: 'geoffwoo-final-critic-v1',
      finalCriticScores: expect.objectContaining({ nativeVoice: 0.8 }),
    });

    const edited = await updateTweet(tweet.id, {
      content: `${tweet.content}. edited by the operator`,
    });
    expect(edited).toMatchObject({
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      qualityPolicyVersion: null,
      voiceCorpusVersion: null,
      judgeProvider: null,
      judgeModel: null,
      finalCriticProvider: null,
      finalCriticModel: null,
      finalCriticVerdict: null,
      finalCriticVersion: null,
    });
  });
});
