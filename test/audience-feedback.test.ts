import { describe, expect, it } from 'vitest';
import { classifyAudienceVoiceComplaint } from '@/lib/audience-feedback';
import { filterLearningMentions } from '@/lib/performance';
import {
  createMention,
  createTweet,
  backfillAudienceVoiceComplaints,
  getAudienceVoiceComplaints,
  getLearningSignals,
} from '@/lib/kv-storage';

describe('audience voice complaints', () => {
  it('only marks explicit high-confidence voice complaints', () => {
    expect(classifyAudienceVoiceComplaint('this is AI slop and does not sound like you')).toMatchObject({
      isComplaint: true,
      confidence: 0.98,
      tags: expect.arrayContaining(['ai_slop', 'not_your_voice']),
    });
    expect(classifyAudienceVoiceComplaint('this reads like a bot')).toMatchObject({
      isComplaint: true,
      tags: ['bot_voice'],
    });
    expect(classifyAudienceVoiceComplaint('i disagree with the capex assumption')).toEqual({
      isComplaint: false,
      confidence: 0,
      tags: [],
    });
    expect(classifyAudienceVoiceComplaint('this does not sound like AI slop')).toEqual({
      isComplaint: false,
      confidence: 0,
      tags: [],
    });
  });

  it('stores parent-linked metrics without creating operator learning signals', async () => {
    const agentId = `agent-complaint-${Date.now()}`;
    const parent = await createTweet({
      agentId,
      content: 'the real moat is the feedback loop. the winners will compound faster.',
      type: 'original',
      status: 'posted',
      format: 'hot_take',
      topic: 'ai',
      xTweetId: `x-parent-${Date.now()}`,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      rationale: 'generated test post',
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      sourceLane: 'manual_core_exploit',
      qualityPolicyVersion: 'policy-test',
    } as any);

    await createMention({
      agentId,
      author: 'Reader',
      authorHandle: 'reader',
      content: 'this is obvious AI slop and does not sound like you',
      tweetId: `x-complaint-${Date.now()}`,
      conversationId: parent.xTweetId,
      inReplyToTweetId: parent.xTweetId,
      engagementLikes: 2,
      engagementRetweets: 0,
      createdAt: new Date().toISOString(),
    });

    const complaints = await getAudienceVoiceComplaints(agentId);
    const signals = await getLearningSignals(agentId);

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toMatchObject({
      parentTweetId: parent.id,
      parentXTweetId: parent.xTweetId,
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      sourceLane: 'manual_core_exploit',
      qualityPolicyVersion: 'policy-test',
      tags: expect.arrayContaining(['ai_slop', 'not_your_voice']),
    });
    expect(signals).toHaveLength(0);
  });

  it('keeps complaint replies out of learning aggregates', () => {
    const base = {
      id: 'mention-1',
      agentId: 'agent-1',
      author: 'Reader',
      authorHandle: 'reader',
      tweetId: 'x-mention-1',
      conversationId: 'x-parent',
      inReplyToTweetId: 'x-parent',
      engagementLikes: 0,
      engagementRetweets: 0,
      createdAt: '2026-07-31T00:00:00.000Z',
    };
    const filtered = filterLearningMentions([
      { ...base, content: 'this reads like a bot and does not sound like you' },
      { ...base, id: 'mention-2', tweetId: 'x-mention-2', content: 'the capex assumption is too low' },
    ] as any);

    expect(filtered.map((mention) => mention.id)).toEqual(['mention-2']);
  });

  it('rescans stored mentions idempotently for complaint metrics', async () => {
    const agentId = `agent-complaint-backfill-${Date.now()}`;
    await createMention({
      agentId,
      author: 'Reader',
      authorHandle: '@reader',
      content: 'this reads like a bot and does not sound like you',
      tweetId: `x-complaint-backfill-${Date.now()}`,
      conversationId: 'x-parent-backfill',
      inReplyToTweetId: 'x-parent-backfill',
      engagementLikes: 0,
      engagementRetweets: 0,
      createdAt: new Date().toISOString(),
    });

    const backfill = await backfillAudienceVoiceComplaints(agentId);

    expect(backfill).toMatchObject({ scanned: 1, matched: 1, added: 0, total: 1 });
    await expect(getAudienceVoiceComplaints(agentId)).resolves.toHaveLength(1);
  });
});
