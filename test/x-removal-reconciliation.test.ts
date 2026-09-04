import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tweet } from '@/lib/types';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), update: vi.fn(), signal: vi.fn(), log: vi.fn() }));
vi.mock('@/lib/twitter-client', () => ({ lookupTweetAvailability: mocks.lookup }));
vi.mock('@/lib/kv-storage', () => ({ updateTweet: mocks.update, addLearningSignal: mocks.signal, addPostLogEntry: mocks.log }));
import { reconcileXRemovals } from '@/lib/x-removal-reconciliation';

const now = new Date('2026-09-04T12:00:00Z');
const post = { id: 't1', agentId: 'a1', xTweetId: 'x1', status: 'posted', type: 'original', content: 'A complete post.',
  createdAt: '2026-09-03T12:00:00Z', postedAt: '2026-09-03T12:00:00Z' } as Tweet;
const keys = { appKey: 'test', appSecret: 'test', accessToken: 'test', accessSecret: 'test' };

describe('official removal reconciliation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not interpret a missing timeline entry or a reply excluded from the timeline as a deletion', async () => {
    mocks.lookup.mockResolvedValue({ status: 'present', tweetId: 'x1' });
    await reconcileXRemovals({ id: 'a1' }, keys, [{ ...post, type: 'reply' }], new Set(), [], now);
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith('t1', expect.objectContaining({ xRemovalConfirmationCount: 0 }));
    expect(mocks.update.mock.calls.some(([, update]) => update.status)).toBe(false);
  });
  it('leaves state and negative feedback intact on an unavailable lookup', async () => {
    mocks.lookup.mockResolvedValue({ status: 'unavailable', tweetId: 'x1' });
    await reconcileXRemovals({ id: 'a1' }, keys, [post], new Set(), [], now);
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith('t1', { xRemovalLastCheckedAt: now.toISOString() });
  });
  it('requires two explicit not-found checks at least fifteen minutes apart', async () => {
    mocks.lookup.mockResolvedValue({ status: 'not_found', tweetId: 'x1' });
    expect(await reconcileXRemovals({ id: 'a1' }, keys, [post], new Set(), [], now)).toBe(0);
    expect(mocks.signal).not.toHaveBeenCalled();
    const pending = { ...post, xRemovalFirstMissingAt: now.toISOString(), xRemovalLastCheckedAt: now.toISOString(), xRemovalConfirmationCount: 1 };
    await reconcileXRemovals({ id: 'a1' }, keys, [pending], new Set(), [], new Date(now.getTime() + 5 * 60000));
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(await reconcileXRemovals({ id: 'a1' }, keys, [pending], new Set(), [], new Date(now.getTime() + 15 * 60000))).toBe(1);
    expect(mocks.signal).toHaveBeenCalledWith('a1', expect.objectContaining({ inferred: true,
      metadata: expect.objectContaining({ verifiedRemoval: true, confirmationCount: 2 }) }));
    expect(mocks.update).toHaveBeenCalledWith('t1', { status: 'deleted_from_x' });
  });
  it('does not recheck a live timeline item or a confirmed owner deletion', async () => {
    await reconcileXRemovals({ id: 'a1' }, keys, [post], new Set(['x1']), [], now);
    await reconcileXRemovals({ id: 'a1' }, keys, [post], new Set(), [{ id: 's1', agentId: 'a1', tweetId: 't1',
      signalType: 'deleted_from_x', surface: 'queue', rewardDelta: -1, createdAt: now.toISOString() }], now);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it('resets a pending missing observation when the post reappears in the timeline', async () => {
    await reconcileXRemovals({ id: 'a1' }, keys, [{ ...post, xRemovalConfirmationCount: 1,
      xRemovalFirstMissingAt: '2026-09-04T11:00:00Z' }], new Set(['x1']), [], now);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith('t1', expect.objectContaining({ xRemovalFirstMissingAt: null, xRemovalConfirmationCount: 0 }));
  });
});
