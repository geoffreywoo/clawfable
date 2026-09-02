import { describe, expect, it } from 'vitest';
import {
  readJsonObjectBody,
  validateFeedbackEntry,
  validateGenerationRequest,
  validateLearningSignalRequest,
  validateProtocolSettingsPatch,
  validateQueueCreateRequest,
} from '@/lib/request-validation';

function jsonRequest(body: string): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('request validation', () => {
  it('rejects malformed and non-object JSON bodies with one shared error', async () => {
    expect(await readJsonObjectBody(jsonRequest('{'))).toEqual({ ok: false, error: 'Invalid JSON body' });
    expect(await readJsonObjectBody(jsonRequest('null'))).toEqual({ ok: false, error: 'Invalid JSON body' });
    expect(await readJsonObjectBody(jsonRequest('[1]'))).toEqual({ ok: false, error: 'Invalid JSON body' });
    expect(await readJsonObjectBody(jsonRequest('"text"'))).toEqual({ ok: false, error: 'Invalid JSON body' });
    expect(await readJsonObjectBody(jsonRequest('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });

  it('requires a rating plus draft text or a tweetId on feedback entries', () => {
    expect(validateFeedbackEntry({ rating: 'down', generatedAt: '2026-09-01T00:00:00Z' }).ok).toBe(false);
    expect(validateFeedbackEntry({ rating: 'meh', tweetText: 'draft' }).ok).toBe(false);
    expect(validateFeedbackEntry({ rating: 'down', tweetText: 'draft', source: 'made_up' }).ok).toBe(false);
    expect(validateFeedbackEntry(null).ok).toBe(false);
    expect(validateFeedbackEntry({ rating: 'up', tweetId: 'tweet-1', source: 'preview_feedback' })).toEqual({
      ok: true,
      value: {
        tweetId: 'tweet-1',
        tweetText: undefined,
        rating: 'up',
        reason: undefined,
        intentSummary: undefined,
        source: 'preview_feedback',
      },
    });
    expect(validateFeedbackEntry({ rating: 'down', tweetText: '  draft text  ' }).value?.tweetText).toBe('draft text');
  });

  it('clamps generation counts and rejects missing generation intent', () => {
    expect(validateGenerationRequest({ count: 99 }, { maxCount: 20 }).value?.count).toBe(20);
    const missing = validateGenerationRequest({}, { maxCount: 5, requireTopicOrCount: true });
    expect(missing.ok).toBe(false);
  });

  it('allowlists learning signal types and clamps reward deltas', () => {
    const valid = validateLearningSignalRequest({
      signalType: 'taste_more_like_this',
      surface: 'queue',
      rewardDelta: 99,
      metadata: {
        safe: true,
        long: 'x'.repeat(800),
        nested: { no: true },
      },
    });
    expect(valid.ok).toBe(true);
    expect(valid.value?.rewardDelta).toBe(1);
    expect(valid.value?.metadata?.long).toHaveLength(500);
    expect(valid.value?.metadata).not.toHaveProperty('nested');

    expect(validateLearningSignalRequest({
      signalType: 'system_prompt_override',
      surface: 'queue',
      rewardDelta: 0,
    }).ok).toBe(false);
  });

  it('blocks incomplete or abusive queue drafts before they enter the queue', () => {
    expect(validateQueueCreateRequest({ content: 'the real opportunity is this:' }).ok).toBe(false);
    expect(validateQueueCreateRequest({ content: 'you are a stupid clown lol' }).ok).toBe(false);
    expect(validateQueueCreateRequest({ content: 'A useful operator note with a concrete tradeoff and example.' }).ok).toBe(true);
  });

  it('sanitizes protocol settings without persisting invalid stale client values', () => {
    const parsed = validateProtocolSettingsPatch({
      postsPerDay: 200,
      trendTolerance: 'wild-west',
      shitpoastEnabled: 'yes',
      proactiveLikes: true,
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.postsPerDay).toBeLessThanOrEqual(24);
    expect(parsed.value).not.toHaveProperty('trendTolerance');
    expect(parsed.value).not.toHaveProperty('shitpoastEnabled');
    expect(parsed.value?.proactiveLikes).toBe(false);
  });
});
