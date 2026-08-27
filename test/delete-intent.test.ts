import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: mocks.anthropicCreate,
    };
  },
}));

import {
  formatDeleteIntentSoulForPrompt,
  formatDeleteIntentTweetForPrompt,
  inferDeleteIntent,
} from '@/lib/delete-intent';

describe('delete intent prompt budgeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounds SOUL and deleted tweet context', () => {
    const soul = formatDeleteIntentSoulForPrompt(`# soul\n${'voice detail '.repeat(100)}SOUL_SENTINEL`);
    const tweet = formatDeleteIntentTweetForPrompt(`core tweet ${'draft detail '.repeat(100)}TWEET_SENTINEL`);

    expect(soul.length).toBeLessThan(650);
    expect(soul).not.toContain('SOUL_SENTINEL');
    expect(tweet.length).toBeLessThan(750);
    expect(tweet).toContain('core tweet');
    expect(tweet).not.toContain('TWEET_SENTINEL');
  });

  it('uses compact context and a small completion budget for inference', async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Too vague for the account voice.' }],
      stop_reason: 'end_turn',
    });

    const summary = await inferDeleteIntent({
      agentName: 'Operator Agent',
      soulMd: `# soul\n${'voice detail '.repeat(100)}SOUL_SENTINEL`,
      tweetText: `core tweet ${'draft detail '.repeat(100)}TWEET_SENTINEL`,
    });

    const call = mocks.anthropicCreate.mock.calls[0]?.[0];
    const prompt = String(call?.messages?.[0]?.content || '');
    expect(summary).toBe('Too vague for the account voice.');
    expect(call.max_tokens).toBe(48);
    expect(prompt).toContain('core tweet');
    expect(prompt).not.toContain('SOUL_SENTINEL');
    expect(prompt).not.toContain('TWEET_SENTINEL');
  });
});
