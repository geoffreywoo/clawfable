import { describe, expect, it } from 'vitest';
import {
  createAgent,
  createTweet,
  getAgent,
  getProtocolSettings,
  getTweet,
  quarantineAgentAutomation,
  updateProtocolSettings,
} from '@/lib/kv-storage';

describe('automation quarantine', () => {
  it('disables every background action while preserving history and X credentials', async () => {
    const agent = await createAgent({
      handle: `blocked-${Date.now()}`,
      name: 'Blocked Account',
      soulMd: '# SOUL',
      apiKey: 'encrypted-api-key',
      apiSecret: 'encrypted-api-secret',
      accessToken: 'encrypted-access-token',
      accessSecret: 'encrypted-access-secret',
      isConnected: 1,
      xUserId: 'x-blocked',
    } as any);
    await updateProtocolSettings(agent.id, {
      enabled: true,
      autoReply: true,
      proactiveReplies: true,
      proactiveLikes: true,
      autoFollow: true,
      agentShoutouts: true,
      earlyVelocityFollowups: true,
      supervisedTrendDesk: true,
      relationshipQueueEnabled: true,
      portfolioOptimizerEnabled: true,
      marketingEnabled: true,
    });
    const generated = await createTweet({
      agentId: agent.id,
      content: 'qualified generated artifact',
      type: 'original',
      status: 'queued',
      topic: 'test',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: new Date().toISOString(),
      pipelineVersion: 'v2',
      contentProvenance: 'generated_v2',
      generationRunId: 'run-test',
      ideaId: 'idea-test',
      draftCandidateId: 'draft-test',
    });
    const operator = await createTweet({
      agentId: agent.id,
      content: 'operator-authored artifact',
      type: 'original',
      status: 'queued',
      topic: 'test',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: new Date().toISOString(),
      contentProvenance: 'operator_written',
    });

    const result = await quarantineAgentAutomation(agent.id, 'payment required');
    const [settings, generatedAfter, operatorAfter, agentAfter] = await Promise.all([
      getProtocolSettings(agent.id),
      getTweet(generated.id),
      getTweet(operator.id),
      getAgent(agent.id),
    ]);

    expect(result).toEqual({ generatedQuarantined: 1, operatorDraftsReturned: 1 });
    expect(settings).toMatchObject({
      enabled: false,
      autoReply: false,
      proactiveReplies: false,
      proactiveLikes: false,
      autoFollow: false,
      agentShoutouts: false,
      earlyVelocityFollowups: false,
      supervisedTrendDesk: false,
      relationshipQueueEnabled: false,
      portfolioOptimizerEnabled: false,
      marketingEnabled: false,
    });
    expect(generatedAfter).toMatchObject({
      status: 'quarantined',
      preQuarantineStatus: 'queued',
      quarantineReason: 'payment required',
      content: generated.content,
    });
    expect(operatorAfter).toMatchObject({
      status: 'draft',
      preQuarantineStatus: 'queued',
      content: operator.content,
    });
    expect(agentAfter).toMatchObject({
      apiKey: 'encrypted-api-key',
      apiSecret: 'encrypted-api-secret',
      accessToken: 'encrypted-access-token',
      accessSecret: 'encrypted-access-secret',
      isConnected: 1,
      xUserId: 'x-blocked',
    });
  });
});
