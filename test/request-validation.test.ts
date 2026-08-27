import { describe, expect, it } from 'vitest';
import {
  validateGenerationRequest,
  validateLearningSignalRequest,
  validateProtocolSettingsPatch,
  validateQueueCreateRequest,
} from '@/lib/request-validation';

describe('request validation', () => {
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
