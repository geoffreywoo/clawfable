import { afterEach, expect, it, vi } from 'vitest';
import { addPerformanceEntry, createAgent } from '@/lib/kv-storage';
import type { TweetPerformance } from '@/lib/types';

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ai')>(),
  generateText: vi.fn(async () => ({ text: '- Keep the specific factory constraint in the opening.' })),
}));
import { generateText } from '@/lib/ai';
import { buildLearnings } from '@/lib/performance';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('reuses paid insights across rebuilt timestamps but refreshes changed evidence and model policy', async () => {
  vi.stubEnv('AI_BUDGET_TEST_ENFORCE', 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-27T08:00:00Z'));
  const agent = await createAgent({ handle: 'insight-cache', name: 'Cache', soulMd: '# soul' } as any);
  const rows = Array.from({ length: 6 }, (_, i) => ({
    tweetId: `cache-${i}`, xTweetId: `cache-x-${i}`,
    content: `Factory line ${i} lost a shift waiting for a replacement die.`,
    format: 'observation', topic: 'Manufacturing', source: 'autopilot',
    postedAt: '2026-09-01T00:00:00Z', checkedAt: '2026-09-02T00:00:00Z',
    performanceCheckpoint: 'late', likes: 10 + i, retweets: 2, replies: 1,
    impressions: 1000, engagementRate: 1.3, wasViral: false,
  } as TweetPerformance));
  for (const row of rows) await addPerformanceEntry(agent.id, row);
  const first = await buildLearnings(agent, { backfillAudienceFeedback: false });
  expect(generateText).toHaveBeenCalledTimes(1);

  vi.setSystemTime(new Date('2026-09-27T09:00:00Z'));
  const second = await buildLearnings(agent, { backfillAudienceFeedback: false });
  expect(second.styleFingerprint?.updatedAt).not.toBe(first.styleFingerprint?.updatedAt);
  expect(second.insights).toEqual(first.insights);
  expect(generateText).toHaveBeenCalledTimes(1);

  // A new observation of identical metrics is still the same model input.
  await addPerformanceEntry(agent.id, { ...rows[5], checkedAt: '2026-09-27T09:00:00Z' });
  await buildLearnings(agent, { backfillAudienceFeedback: false });
  expect(generateText).toHaveBeenCalledTimes(1);

  await addPerformanceEntry(agent.id, { ...rows[5], likes: 900, checkedAt: '2026-09-27T10:00:00Z' });
  await buildLearnings(agent, { backfillAudienceFeedback: false });
  expect(generateText).toHaveBeenCalledTimes(2);
  expect(vi.mocked(generateText).mock.calls[1][0].prompt).toContain('900 likes');

  vi.stubEnv('AI_MODEL_POLICY', 'new-insight-model-policy');
  await buildLearnings(agent, { backfillAudienceFeedback: false });
  expect(generateText).toHaveBeenCalledTimes(3);
});
