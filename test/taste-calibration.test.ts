import { describe, expect, it } from 'vitest';
import { buildTasteCalibrationQueue } from '@/lib/taste-calibration';
import type { Tweet } from '@/lib/types';

function tweet(id: string, overrides: Partial<Tweet> = {}): Tweet {
  return {
    id,
    agentId: 'agent-1',
    content: `Draft ${id} about AI agents and operator taste.`,
    type: 'original',
    status: 'queued',
    format: 'hot_take',
    topic: 'AI',
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    deletionReason: null,
    createdAt: `2026-05-24T12:00:0${id}.000Z`,
    confidenceScore: 0.62,
    candidateScore: 70,
    voiceScore: 0.7,
    predictedEngagementScore: 0.6,
    surpriseScore: 0.3,
    creativeRiskScore: 0.2,
    policyRiskScore: 0.1,
    slopScore: 0.1,
    replyBaitScore: 0.3,
    ...overrides,
  };
}

describe('taste calibration', () => {
  it('selects distinct queue drafts for owner calibration roles', () => {
    const snapshot = buildTasteCalibrationQueue([
      tweet('1', { candidateScore: 95, confidenceScore: 0.9 }),
      tweet('2', { policyRiskScore: 0.02, creativeRiskScore: 0.03, slopScore: 0.02 }),
      tweet('3', { surpriseScore: 0.9, creativeRiskScore: 0.45 }),
      tweet('4', { replyBaitScore: 0.9, surpriseScore: 0.7 }),
      tweet('5', { confidenceScore: 0.55, voiceScore: 0.42 }),
      tweet('6', { status: 'posted' }),
    ], new Date('2026-05-24T12:00:00.000Z'));

    expect(snapshot.items.map((item) => item.role)).toEqual([
      'best',
      'safest',
      'weirdest',
      'provocative',
      'uncertain',
    ]);
    expect(new Set(snapshot.items.map((item) => item.tweet.id)).size).toBe(snapshot.items.length);
    expect(snapshot.items.some((item) => item.tweet.status === 'posted')).toBe(false);
  });
});
