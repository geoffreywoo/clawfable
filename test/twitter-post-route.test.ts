import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addLearningSignal, createAgent, createTweet, getLearningSignals, getTweet, updateTweet } from '@/lib/kv-storage';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
  postTweet: vi.fn(),
  replyToTweet: vi.fn(),
  decodeKeys: vi.fn(() => ({
    appKey: 'app-key',
    appSecret: 'app-secret',
    accessToken: 'access-token',
    accessSecret: 'access-secret',
  })),
  getSanitizedTweetTextIssue: vi.fn(() => null),
  resolveQueuedTweetFailure: vi.fn(),
  acquireAutopilotLock: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  addPostLogEntry: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/kv-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kv-storage')>('@/lib/kv-storage');
  return {
    ...actual,
    acquireAutopilotLock: mocks.acquireAutopilotLock,
    releaseAutopilotLock: mocks.releaseAutopilotLock,
    addPostLogEntry: mocks.addPostLogEntry,
  };
});

vi.mock('@/lib/twitter-client', () => ({
  postTweet: mocks.postTweet,
  replyToTweet: mocks.replyToTweet,
  decodeKeys: mocks.decodeKeys,
  getSanitizedTweetTextIssue: mocks.getSanitizedTweetTextIssue,
}));

vi.mock('@/lib/queue-healing', () => ({
  resolveQueuedTweetFailure: mocks.resolveQueuedTweetFailure,
}));

vi.mock('@/lib/automation-entitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement');
  return {
    ...actual,
    assertAgentAutomationEntitlement: vi.fn(async () => ({
      source: 'agent_exemption',
      eligible: true,
      reason: 'test exemption',
      verifiedAt: new Date().toISOString(),
      paidThrough: null,
      paidInvoiceId: null,
      paidAmountCents: null,
      paidCurrency: null,
    })),
  };
});

import { POST } from '@/app/api/agents/[id]/twitter/post/route';
import { TwitterActionError } from '@/lib/twitter-debug';
import { ANTIFUND_PORTFOLIO_COMPANIES, buildAntiFundPortfolioContext } from '@/lib/antifund-portfolio';

describe('twitter post route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSanitizedTweetTextIssue.mockReturnValue(null);
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: true,
      owner: 'manual-post-lock',
      lock: {
        agentId: 'agent',
        owner: 'manual-post-lock',
        purpose: 'manual',
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
    mocks.releaseAutopilotLock.mockResolvedValue(true);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.postTweet.mockResolvedValue({
      tweetId: 'x-post-1',
      tweetUrl: 'https://x.com/manual-post-guard/status/x-post-1',
      username: 'manual-post-guard',
    });
    mocks.replyToTweet.mockResolvedValue({
      tweetId: 'x-reply-1',
      tweetUrl: 'https://x.com/manual-post-guard/status/x-reply-1',
      username: 'manual-post-guard',
    });
    mocks.resolveQueuedTweetFailure.mockImplementation(async (_agent: unknown, tweet: any) => {
      const updated = await updateTweet(tweet.id, {
        status: 'quarantined',
        scheduledAt: null,
        quarantinedAt: new Date().toISOString(),
        quarantineReason: 'Draft failed queue validation: mid-word or mid-thought',
        preQuarantineStatus: tweet.status,
      });
      return {
        action: 'quarantined',
        tweet: updated,
        detail: 'Quarantined the immutable draft.',
      };
    });
  });

  it.each(['posted', 'deleted', 'edited', 'quarantined', 'quarantine_marker', 'eligibility_revoked', 'unknown_lifecycle'] as const)(
    'rechecks uncached persisted state when another server %s the draft before lock acquisition', async (change) => {
      const agent = await createAgent({ handle: `manual-stale-${change}`, name: 'Guard', soulMd: '# soul',
        apiKey: 'key', apiSecret: 'secret', accessToken: 'token', accessSecret: 'secret', isConnected: 1,
        xUserId: `x-stale-${change}` } as any);
      const tweet = await createTweet({ agentId: agent.id, content: 'We shipped the first cache invalidation test today.',
        type: 'original', status: change === 'unknown_lifecycle' ? 'archived_legacy' : 'draft', contentProvenance: 'operator_written' } as any);
      mocks.requireAgentAccess.mockResolvedValue({ agent, user: { id: 'owner' } });
      mocks.acquireAutopilotLock.mockImplementationOnce(async () => {
        // Simulate another server: write storage without this module's cache invalidation.
        const store = (globalThis as any)[Symbol.for('clawfable.localKvFallback')].memStore as Map<string, unknown>;
        const key = `tweet:${tweet.id}`;
        const existing = store.get(key) as Record<string, unknown>;
        if (change === 'unknown_lifecycle') { /* Both snapshots contain the same invalid legacy status. */ }
        else if (change === 'deleted') store.delete(key);
        else store.set(key, { ...existing,
          ...(change === 'posted' ? { status: 'posted', xTweetId: 'already-on-x' }
            : change === 'edited' ? { content: 'A different saved draft.' }
              : change === 'quarantine_marker' ? { quarantinedAt: new Date().toISOString() }
                : change === 'eligibility_revoked' ? { contentProvenance: 'historical_v1' } : { status: 'quarantined' }),
        });
        return { acquired: true, owner: 'manual-post-lock' };
      });
      const response = await POST(new Request('http://localhost/api/post', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tweetId: tweet.id, content: tweet.content }),
      }) as any, { params: Promise.resolve({ id: agent.id }) });
      expect(response.status).toBe(change === 'posted' ? 200 : change === 'deleted' ? 404 : 409);
      if (change === 'posted') expect(await response.json()).toMatchObject({ alreadyPosted: true, tweetId: 'already-on-x' });
      expect(mocks.postTweet).not.toHaveBeenCalled();
      expect(mocks.replyToTweet).not.toHaveBeenCalled();
      expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith(agent.id, 'manual-post-lock');
    },
  );

  it('answers 400 for a malformed JSON body before touching X', async () => {
    const agent = await createAgent({
      handle: 'manual-post-json-guard',
      name: 'Guard Agent',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-manual-post-json-guard',
    } as any);
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid JSON body');
    expect(mocks.postTweet).not.toHaveBeenCalled();
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
  });

  it('blocks random sports at the final X write while allowing qualified portfolio business context', async () => {
    const agent = await createAgent({
      handle: 'geoffreywoo',
      name: 'Geoff Woo',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-geoffwoo-policy',
    } as any);
    const randomSports = await createTweet({
      agentId: agent.id,
      content: 'The Lakers should sign this NBA player tonight.',
      type: 'original',
      status: 'draft',
      topic: 'sports',
      contentProvenance: 'operator_written',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const blocked = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: randomSports.content, tweetId: randomSports.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ code: 'account_publish_policy' });
    expect(mocks.postTweet).not.toHaveBeenCalled();

    const betrContext = buildAntiFundPortfolioContext(
      ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'betr')!,
      'constructive_conviction',
    );
    const portfolioBusiness = await createTweet({
      agentId: agent.id,
      content: 'Betr can build the consumer media and distribution layer for sports betting.',
      type: 'original',
      status: 'draft',
      topic: 'Betr startup conviction',
      contentProvenance: 'operator_written',
      portfolioCompanyContext: betrContext,
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    const allowed = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: portfolioBusiness.content, tweetId: portfolioBusiness.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(allowed.status).toBe(200);
    expect(mocks.postTweet).toHaveBeenCalledWith(expect.any(Object), portfolioBusiness.content, {
      username: 'geoffreywoo',
    });
  });

  it('quarantines incomplete queued drafts without rewriting them', async () => {
    const agent = await createAgent({
      handle: 'manual-post-lock',
      name: 'Manual Post Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);

    const tweet = await createTweet({
      agentId: agent.id,
      content: 'psa to every vc partner still doing "pattern matching":\n\n' +
        'your entire investment thesis just became obsolete\n\n' +
        "while you're scheduling 47 coffee meetings to evaluate one deal, mythos agents are processing 10k startups per day with better accuracy than y",
      type: 'original',
      status: 'queued',
      topic: 'vc',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    mocks.requireAgentAccess.mockResolvedValue({
      user: { id: 'user-1' },
      agent,
    });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );

    const data = await response.json();
    const updatedTweet = await getTweet(tweet.id);

    expect(response.status).toBe(422);
    expect(String(data.error)).toContain('mid-word or mid-thought');
    expect(data.autoFixed).toBe(false);
    expect(mocks.postTweet).not.toHaveBeenCalled();
    expect(updatedTweet?.status).toBe('quarantined');
    expect(updatedTweet?.quarantinedAt).toEqual(expect.any(String));
    expect(updatedTweet?.quarantineReason).toContain('mid-word or mid-thought');
    expect(updatedTweet?.content).toBe(tweet.content);
  });

  it('posts through the agent lock and passes the known handle to X writes', async () => {
    const agent = await createAgent({
      handle: 'manual-post-already',
      name: 'Manual Post Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);
    const tweet = await createTweet({
      agentId: agent.id,
      content: 'the infra audit only matters if retries cannot duplicate writes',
      type: 'original',
      status: 'queued',
      topic: 'infra',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.acquireAutopilotLock).toHaveBeenCalledWith(
      agent.id,
      expect.stringContaining(`manual-post:`),
      8 * 60,
      'manual',
    );
    expect(mocks.postTweet).toHaveBeenCalledWith(
      expect.anything(),
      tweet.content,
      { username: agent.handle },
    );
    expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith(agent.id, 'manual-post-lock');
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        tweetId: tweet.id,
        xTweetId: 'x-post-1',
        source: 'manual',
        action: 'posted',
      }),
    );
  });

  it('blocks a legacy generated Geoffrey draft before acquiring the post lock', async () => {
    const agent = await createAgent({
      handle: 'geoffwoo',
      name: 'Geoffrey Woo',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-geoffwoo',
    } as any);
    const tweet = await createTweet({
      agentId: agent.id,
      content: 'a retired V1 generated draft',
      type: 'original',
      status: 'queued',
      pipelineVersion: 'v1',
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      topic: 'startups',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe('generation_origin_retired');
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
    expect(mocks.postTweet).not.toHaveBeenCalled();
  });

  it('does not train or mutate the queue when X posting is rate limited', async () => {
    const agent = await createAgent({
      handle: 'manual-rate-limit-guard',
      name: 'Manual Rate Limit Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-rate-limit-1',
    } as any);

    const tweet = await createTweet({
      agentId: agent.id,
      content: 'The winning accounts turn audience questions into weekly proof, not random hot takes.',
      type: 'original',
      status: 'queued',
      topic: 'audience',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    mocks.requireAgentAccess.mockResolvedValue({
      user: { id: 'user-1' },
      agent,
    });
    mocks.postTweet.mockRejectedValue(new TwitterActionError({
      action: 'post_tweet',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );

    const data = await response.json();
    const unchangedTweet = await getTweet(tweet.id);
    const signals = await getLearningSignals(agent.id, 10);

    expect(response.status).toBe(429);
    expect(data.retryable).toBe(true);
    expect(data.queueResolved).toBe(false);
    expect(data.error).toContain('X posting is rate limited until 2026-04-07T12:20:00.000Z');
    expect(mocks.resolveQueuedTweetFailure).not.toHaveBeenCalled();
    expect(unchangedTweet?.status).toBe('queued');
    expect(unchangedTweet?.content).toBe(tweet.content);
    expect(signals).toEqual([]);
  });

  it('returns an already-posted result without posting a duplicate', async () => {
    const agent = await createAgent({
      handle: 'manual-post-ownership',
      name: 'Manual Post Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);
    const tweet = await createTweet({
      agentId: agent.id,
      content: 'already shipped',
      type: 'original',
      status: 'posted',
      topic: 'infra',
      xTweetId: 'x-existing',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.alreadyPosted).toBe(true);
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
    expect(mocks.postTweet).not.toHaveBeenCalled();
  });

  it('blocks a second manual reply to the same root conversation before calling X', async () => {
    const agent = await createAgent({
      handle: 'manual-reply-root-guard',
      name: 'Manual Reply Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);
    await createTweet({
      agentId: agent.id,
      content: 'already answered this root',
      type: 'reply',
      status: 'posted',
      topic: 'reply',
      xTweetId: 'x-existing-reply',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      followupForTweetId: 'target-reply-a',
      replyConversationId: 'root-tweet-1',
      scheduledAt: null,
    });
    const draft = await createTweet({
      agentId: agent.id,
      content: 'second answer to same root',
      type: 'reply',
      status: 'draft',
      topic: 'reply',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      followupForTweetId: 'target-reply-b',
      replyConversationId: 'root-tweet-1',
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft.content,
          tweetId: draft.id,
          replyToId: 'target-reply-b',
          conversationId: 'root-tweet-1',
        }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );
    const data = await response.json();
    const unchangedDraft = await getTweet(draft.id);

    expect(response.status).toBe(409);
    expect(data.code).toBe('duplicate_reply_conversation');
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
    expect(unchangedDraft?.status).toBe('draft');
    expect(unchangedDraft?.xTweetId).toBeNull();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        tweetId: draft.id,
        format: 'manual_reply_duplicate_gate',
        action: 'skipped',
      }),
    );
  });

  it('uses legacy reply_posted signals to block repeated root replies', async () => {
    const agent = await createAgent({
      handle: 'manual-reply-legacy-guard',
      name: 'Manual Reply Legacy Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);
    await addLearningSignal(agent.id, {
      xTweetId: 'legacy-posted-reply',
      signalType: 'reply_posted',
      surface: 'engage',
      rewardDelta: 0.34,
      metadata: {
        targetTweetId: 'legacy-root-tweet',
      },
    });
    const draft = await createTweet({
      agentId: agent.id,
      content: 'new answer to old root',
      type: 'reply',
      status: 'draft',
      topic: 'reply',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      followupForTweetId: 'legacy-root-tweet',
      replyConversationId: 'legacy-root-tweet',
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft.content,
          tweetId: draft.id,
          replyToId: 'legacy-root-tweet',
          conversationId: 'legacy-root-tweet',
        }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe('duplicate_reply_conversation');
    expect(data.duplicateSource).toBe('learning_signal');
    expect(data.existingXTweetId).toBe('legacy-posted-reply');
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });

  it('rejects tweet ids that do not belong to the agent', async () => {
    const agent = await createAgent({
      handle: 'manual-post-guard',
      name: 'Manual Post Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);
    const otherAgent = await createAgent({
      handle: 'manual-post-other',
      name: 'Other Agent',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-api-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-other',
    } as any);
    const otherTweet = await createTweet({
      agentId: otherAgent.id,
      content: 'this belongs somewhere else',
      type: 'original',
      status: 'queued',
      topic: 'infra',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: otherTweet.content, tweetId: otherTweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.postTweet).not.toHaveBeenCalled();
  });

  it('returns 409 when another cron or manual run holds the agent lock', async () => {
    const agent = await createAgent({
      handle: 'manual-post-blocked',
      name: 'Manual Post Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);
    const tweet = await createTweet({
      agentId: agent.id,
      content: 'one writer at a time',
      type: 'original',
      status: 'queued',
      topic: 'infra',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: false,
      owner: 'blocked-owner',
      lock: {
        agentId: agent.id,
        owner: 'cron',
        purpose: 'cron',
        acquiredAt: '2026-05-25T15:00:00.000Z',
        expiresAt: '2026-05-25T15:08:00.000Z',
      },
    });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.postTweet).not.toHaveBeenCalled();
    expect(mocks.releaseAutopilotLock).not.toHaveBeenCalled();
  });
});
