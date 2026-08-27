import type { Tweet } from './types';

export type TasteCalibrationRole = 'best' | 'safest' | 'weirdest' | 'provocative' | 'uncertain';

export interface TasteCalibrationItem {
  role: TasteCalibrationRole;
  label: string;
  reason: string;
  tweet: Tweet;
  score: number;
}

export interface TasteCalibrationSnapshot {
  generatedAt: string;
  items: TasteCalibrationItem[];
  summary: string;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function numeric(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function eligibleDrafts(tweets: Tweet[]): Tweet[] {
  return tweets.filter((tweet) =>
    ['queued', 'draft', 'preview'].includes(tweet.status)
    && tweet.type !== 'reply'
    && !tweet.quarantinedAt
    && tweet.content.trim().length > 0
  );
}

function roleScore(role: TasteCalibrationRole, tweet: Tweet): number {
  const confidence = numeric(tweet.confidenceScore, numeric(tweet.candidateScore, 67) / 100);
  const candidate = numeric(tweet.candidateScore, confidence * 100) / 100;
  const surprise = numeric(tweet.surpriseScore);
  const creativeRisk = numeric(tweet.creativeRiskScore);
  const policyRisk = numeric(tweet.policyRiskScore);
  const slopRisk = numeric(tweet.slopScore);
  const replyBait = numeric(tweet.replyBaitScore);
  const voice = numeric(tweet.voiceScore, 0.6);
  const predicted = numeric(tweet.predictedEngagementScore, numeric(tweet.rewardPrediction, 0.5));

  switch (role) {
    case 'best':
      return clamp((confidence * 0.34) + (candidate * 0.22) + (predicted * 0.22) + (voice * 0.16) + ((1 - slopRisk) * 0.06));
    case 'safest':
      return clamp((confidence * 0.28) + (voice * 0.22) + ((1 - policyRisk) * 0.24) + ((1 - creativeRisk) * 0.16) + ((1 - slopRisk) * 0.1));
    case 'weirdest':
      return clamp((surprise * 0.42) + (creativeRisk * 0.16) + (predicted * 0.18) + ((1 - policyRisk) * 0.14) + ((1 - slopRisk) * 0.1));
    case 'provocative':
      return clamp((replyBait * 0.28) + (surprise * 0.22) + (creativeRisk * 0.14) + (predicted * 0.16) + ((1 - policyRisk) * 0.2));
    case 'uncertain':
      return clamp((1 - Math.abs(confidence - 0.56) * 2) * 0.45 + surprise * 0.18 + predicted * 0.14 + (1 - voice) * 0.12 + replyBait * 0.11);
  }
}

function roleLabel(role: TasteCalibrationRole): string {
  switch (role) {
    case 'best':
      return 'Best predicted';
    case 'safest':
      return 'Safest';
    case 'weirdest':
      return 'Weirdest';
    case 'provocative':
      return 'Most provocative';
    case 'uncertain':
      return 'Needs taste call';
  }
}

function roleReason(role: TasteCalibrationRole, tweet: Tweet): string {
  const confidence = Math.round(numeric(tweet.confidenceScore, numeric(tweet.candidateScore, 67) / 100) * 100);
  switch (role) {
    case 'best':
      return `Highest blend of confidence, voice fit, and predicted growth. Confidence ${confidence}%.`;
    case 'safest':
      return 'Lowest visible risk while still clearing the ranking stack.';
    case 'weirdest':
      return 'Pushes surprise or creative lane furthest without tripping hard risk gates.';
    case 'provocative':
      return 'Most likely to create replies or tension; worth calibrating before autopilot trusts it.';
    case 'uncertain':
      return 'Near the decision boundary, so owner feedback teaches the model fastest.';
  }
}

export function buildTasteCalibrationQueue(tweets: Tweet[], now = new Date()): TasteCalibrationSnapshot {
  const candidates = eligibleDrafts(tweets);
  const selected = new Map<string, TasteCalibrationItem>();
  const roles: TasteCalibrationRole[] = ['best', 'safest', 'weirdest', 'provocative', 'uncertain'];

  for (const role of roles) {
    const pick = candidates
      .filter((tweet) => !selected.has(String(tweet.id)))
      .map((tweet) => ({ tweet, score: roleScore(role, tweet) }))
      .sort((a, b) => b.score - a.score || Date.parse(b.tweet.createdAt) - Date.parse(a.tweet.createdAt))[0];
    if (!pick) continue;
    selected.set(String(pick.tweet.id), {
      role,
      label: roleLabel(role),
      reason: roleReason(role, pick.tweet),
      tweet: pick.tweet,
      score: Math.round(pick.score * 100),
    });
  }

  const items = [...selected.values()];
  return {
    generatedAt: now.toISOString(),
    items,
    summary: items.length > 0
      ? `${items.length} calibration draft${items.length === 1 ? '' : 's'} selected from the current queue.`
      : 'No active drafts are available for taste calibration yet.',
  };
}
