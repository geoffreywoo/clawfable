import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSoulHistoryTweets, generateSoulFromTweets, getSoulFromTweetsMaxTokens, getSoulSummaryMaxTokens } from '@/lib/soul-from-tweets';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getDeepTimeline: vi.fn(),
  getMe: vi.fn(),
  getFollowing: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  generateText: mocks.generateText,
}));

vi.mock('@/lib/twitter-client', () => ({
  getDeepTimeline: mocks.getDeepTimeline,
  getMe: mocks.getMe,
  getFollowing: mocks.getFollowing,
}));

function tweet(index: number, overrides: Partial<{ text: string; likes: number; retweets: number }> = {}) {
  return {
    id: `tweet-${index}`,
    text: overrides.text ?? `tweet ${index} ${'with repeated context '.repeat(30)}TAIL_${index}`,
    likes: overrides.likes ?? 100 - index,
    retweets: overrides.retweets ?? 10,
  };
}

describe('generateSoulFromTweets prompt budgeting', () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.getDeepTimeline.mockReset();
    mocks.getMe.mockReset();
    mocks.getFollowing.mockReset();
  });

  it('compacts tweet history examples for prompts', () => {
    const formatted = formatSoulHistoryTweets([tweet(1), tweet(2)], { limit: 1, includeStats: true });

    expect(formatted).toContain('[99 likes, 10 RTs] "tweet 1');
    expect(formatted).not.toContain('tweet 2');
    expect(formatted).not.toContain('TAIL_1');
  });

  it('scales SOUL-from-history completion budgets by timeline size', () => {
    expect(getSoulFromTweetsMaxTokens(12)).toBe(1536);
    expect(getSoulFromTweetsMaxTokens(25)).toBe(2048);
    expect(getSoulSummaryMaxTokens(12)).toBe(192);
    expect(getSoulSummaryMaxTokens(25)).toBe(256);
  });

  it('caps account-history SOUL and summary prompts while preserving outputs', async () => {
    mocks.getDeepTimeline.mockResolvedValue(Array.from({ length: 40 }, (_, index) => tweet(index + 1)));
    mocks.getMe.mockResolvedValue({ username: 'operator', name: 'Operator' });
    mocks.getFollowing.mockResolvedValue([]);
    mocks.generateText
      .mockResolvedValueOnce({
        text: '# SOUL.md\n\nI am a precise operator voice.',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          tone: 'analyst',
          topics: ['AI agents'],
          voiceSummary: 'Precise operator voice.',
        }),
      });

    const result = await generateSoulFromTweets({} as any, 'user-1', 'Operator Agent');

    const soulPrompt = String(mocks.generateText.mock.calls[0]?.[0]?.prompt || '');
    const summaryPrompt = String(mocks.generateText.mock.calls[1]?.[0]?.prompt || '');
    expect(mocks.generateText.mock.calls[0]?.[0]?.maxTokens).toBe(2048);
    expect(mocks.generateText.mock.calls[1]?.[0]?.maxTokens).toBe(256);
    const topSection = soulPrompt.split('## TOP PERFORMING TWEETS')[1].split('## RECENT TWEETS')[0];
    const recentSection = soulPrompt.split('## RECENT TWEETS')[1].split('## SAMPLE OF ALL TWEETS')[0];
    const sampleSection = soulPrompt.split('## SAMPLE OF ALL TWEETS')[1].split('## LOWEST PERFORMING TWEETS')[0];
    expect(soulPrompt).toContain('## TOP PERFORMING TWEETS');
    expect(topSection).toContain('tweet 10');
    expect(topSection).not.toContain('tweet 11');
    expect(soulPrompt).toContain('## RECENT TWEETS');
    expect(recentSection).toContain('tweet 12');
    expect(recentSection).not.toContain('tweet 13');
    expect(sampleSection).toContain('tweet 16');
    expect(sampleSection).not.toContain('tweet 17');
    expect(soulPrompt).toContain('## LOWEST PERFORMING TWEETS');
    expect(soulPrompt).not.toContain('TAIL_1');
    expect(summaryPrompt).toContain('tweet 8');
    expect(summaryPrompt).not.toContain('tweet 9');
    expect(result.soulMd).toContain('precise operator voice');
    expect(result.detectedTone).toBe('analyst');
    expect(result.detectedTopics).toEqual(['AI agents']);
  });

  it('uses smaller completion budgets for sparse account history', async () => {
    mocks.getDeepTimeline.mockResolvedValue(Array.from({ length: 12 }, (_, index) => tweet(index + 1)));
    mocks.getMe.mockResolvedValue({ username: 'operator', name: 'Operator' });
    mocks.getFollowing.mockResolvedValue([]);
    mocks.generateText
      .mockResolvedValueOnce({ text: '# SOUL.md\n\nCompact.' })
      .mockResolvedValueOnce({ text: JSON.stringify({ tone: 'concise', topics: [], voiceSummary: 'Compact.' }) });

    await generateSoulFromTweets({} as any, 'user-1', 'Operator Agent');

    expect(mocks.generateText.mock.calls[0]?.[0]?.maxTokens).toBe(1536);
    expect(mocks.generateText.mock.calls[1]?.[0]?.maxTokens).toBe(192);
  });
});
