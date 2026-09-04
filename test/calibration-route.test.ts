import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getTweet: vi.fn(), addLearningSignal: vi.fn(), saveFeedback: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAgentAccess: vi.fn(async () => ({})), handleAuthError: vi.fn((err) => { throw err; }) }));
vi.mock('@/lib/kv-storage', () => ({ getTweet: mocks.getTweet, getTweets: vi.fn(), addLearningSignal: mocks.addLearningSignal, saveFeedback: mocks.saveFeedback }));
import { POST } from '@/app/api/agents/[id]/calibration/route';
const draft = { id: 't1', agentId: 'a1', content: 'Our factory has a productivity problem.', topic: 'Manufacturing', format: 'observation' };
const submit = (body: unknown) => POST(new Request('http://localhost/api/calibration', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: 'a1' }) });
describe('calibration edit learning', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getTweet.mockResolvedValue(draft); });
  it('stores the paired owner correction and features without changing the queue', async () => {
    const edited = 'Our packaging line spent 6 hours waiting for one replacement die.';
    expect((await submit({ tweetId: 't1', action: 'edited', editedContent: edited })).status).toBe(200);
    expect(mocks.addLearningSignal).toHaveBeenCalledWith('a1', expect.objectContaining({ signalType: 'taste_calibration_edit',
      metadata: expect.objectContaining({ originalDraft: draft.content, editedDraft: edited, acceptedEdit: true, changedFeatureCount: expect.any(Number) }) }));
    expect(mocks.saveFeedback).not.toHaveBeenCalled();
  });
  it.each(['', draft.content])('rejects a non-edit %s', async (editedContent) => {
    expect((await submit({ tweetId: 't1', action: 'edited', editedContent })).status).toBe(400);
    expect(mocks.addLearningSignal).not.toHaveBeenCalled();
  });
});
