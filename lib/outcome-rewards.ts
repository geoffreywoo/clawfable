import type {
  CandidateFeatureTags,
  LearningSignal,
  OutcomeEpisode,
  RewardBreakdown,
  Tweet,
  TweetPerformance,
} from './types';
import { extractCandidateFeatureTags } from './tweet-features';

export interface EditDeltaSummary {
  summary: string;
  preferenceHints: string[];
  metadata: Record<string, string | number | boolean | null>;
  rewardDelta: number;
}

function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function weightedEngagement(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return entry.likes + (entry.retweets * 2) + (entry.replies * 1.5);
}

function classifyLengthDirection(original: string, edited: string): 'shorter' | 'longer' | null {
  if (edited.length < original.length * 0.85) return 'shorter';
  if (edited.length > original.length * 1.15) return 'longer';
  return null;
}

export function summarizeEditDelta(original: string, edited: string): EditDeltaSummary {
  const originalTags = extractCandidateFeatureTags(original);
  const editedTags = extractCandidateFeatureTags(edited);
  const preferenceHints: string[] = [];
  const changedFeatures: string[] = [];
  const metadata: Record<string, string | number | boolean | null> = {
    originalLength: original.length,
    editedLength: edited.length,
    originalHook: originalTags.hook,
    editedHook: editedTags.hook,
    originalTone: originalTags.tone,
    editedTone: editedTags.tone,
    originalSpecificity: originalTags.specificity,
    editedSpecificity: editedTags.specificity,
    originalStructure: originalTags.structure,
    editedStructure: editedTags.structure,
  };

  const lengthDirection = classifyLengthDirection(original, edited);
  if (lengthDirection) {
    metadata.lengthDirection = lengthDirection;
    changedFeatures.push('length');
    preferenceHints.push(
      lengthDirection === 'shorter'
        ? 'Operators often tighten drafts before approving them.'
        : 'Operators sometimes want more developed arguments before approving.'
    );
  }

  if (originalTags.hook !== editedTags.hook) {
    metadata.hookChanged = true;
    changedFeatures.push('hook');
    preferenceHints.push(`Operators improve the opener by shifting the hook from ${originalTags.hook.replace(/_/g, ' ')} to ${editedTags.hook.replace(/_/g, ' ')}.`);
  }

  const specificityRank = { unknown: 0, abstract: 1, concrete: 2, tactical: 3, story_led: 3, data_driven: 4 } as const;
  if ((specificityRank[editedTags.specificity] || 0) > (specificityRank[originalTags.specificity] || 0)) {
    metadata.addedSpecificity = true;
    changedFeatures.push('specificity');
    preferenceHints.push('Operators add sharper specifics, evidence, or examples before approving.');
  }

  const softerTones = new Set(['earnest', 'analytical', 'casual', 'educational']);
  const sharperTones = new Set(['provocative', 'urgent', 'sarcastic']);
  if (sharperTones.has(originalTags.tone) && softerTones.has(editedTags.tone) && originalTags.tone !== editedTags.tone) {
    metadata.toneSoftened = true;
    changedFeatures.push('tone');
    preferenceHints.push('Operators soften the tone when a draft feels too performative or harsh.');
  }

  if (originalTags.structure !== editedTags.structure) {
    metadata.structureChanged = true;
    changedFeatures.push('structure');
    if (!original.includes('\n') && edited.includes('\n')) {
      metadata.addedStructure = true;
      preferenceHints.push('Line-break structure improves readability and approval odds.');
    } else {
      preferenceHints.push(`Operators reshape structure from ${originalTags.structure.replace(/_/g, ' ')} to ${editedTags.structure.replace(/_/g, ' ')} when a point needs a clearer build.`);
    }
  }

  if (originalTags.thesis !== editedTags.thesis) {
    metadata.claimSharpened = true;
    changedFeatures.push('thesis');
    preferenceHints.push('Operators sharpen the core claim when the original thesis feels fuzzy.');
  }

  const forbiddenPhrases = ['i think', 'in my opinion', 'here’s the thing', "here's the thing", 'the thing is'];
  if (forbiddenPhrases.some((phrase) => original.toLowerCase().includes(phrase) && !edited.toLowerCase().includes(phrase))) {
    metadata.forbiddenPhraseRemoved = true;
    changedFeatures.push('phrasing');
    preferenceHints.push('Operators strip weak throat-clearing phrases before approving.');
  }

  const ctaPattern = /\b(sign up|buy now|subscribe|dm me|join now)\b/i;
  if (ctaPattern.test(original) && !ctaPattern.test(edited)) {
    metadata.ctaRemoved = true;
    changedFeatures.push('cta');
    preferenceHints.push('Promotional CTA language lowers trust unless it is fully earned.');
  }

  metadata.changedFeatureCount = changedFeatures.length;
  metadata.changedFeatures = changedFeatures.join(',');
  metadata.preferredHook = editedTags.hook;
  metadata.preferredTone = editedTags.tone;
  metadata.preferredSpecificity = editedTags.specificity;
  metadata.preferredStructure = editedTags.structure;

  const editIntensity = Math.min(1, changedFeatures.length / 6);
  const rewardDelta = round(clamp(0.38 - (editIntensity * 0.18), 0.12, 0.38));
  const summary = preferenceHints[0] || 'Operator edited this draft before approving it.';

  return {
    summary,
    preferenceHints: preferenceHints.slice(0, 6),
    metadata,
    rewardDelta,
  };
}

function signalBaseReward(signal: LearningSignal): Partial<RewardBreakdown> {
  switch (signal.signalType) {
    case 'approved_without_edit':
      return { approval: 0.85 };
    case 'edited_before_queue':
    case 'edited_before_post': {
      const changedCount = Math.max(1, readNumber(signal.metadata?.changedFeatureCount) || 1);
      return {
        approval: 0.42,
        editBurden: -Math.min(0.24, changedCount * 0.04),
      };
    }
    case 'copied_to_clipboard':
    case 'copied_not_posted':
      return { copySignal: 0.18 };
    case 'deleted_from_queue':
      return { deletionPenalty: -0.78 };
    case 'deleted_from_x':
      return { deletionPenalty: -0.96 };
    case 'reply_generated':
      return { replyOutcome: 0.08 };
    case 'reply_rejected':
      return { replyOutcome: -0.55 };
    case 'reply_posted':
      return { replyOutcome: 0.34 };
    case 'x_post_rejected':
      return { postingOutcome: -0.72 };
    case 'x_post_succeeded':
      return { postingOutcome: 0.32 };
    default:
      return {};
  }
}

function latencyReward(signal: LearningSignal): number {
  const mins = readNumber(signal.metadata?.timeToApprovalMins);
  if (mins === null) return 0;
  if (mins <= 15) return 0.16;
  if (mins <= 60) return 0.08;
  if (mins <= 240) return 0;
  if (mins <= 720) return -0.06;
  return -0.12;
}

export function computePerformanceLiftReward(
  performance: TweetPerformance | undefined,
  baseline?: { avgLikes: number; avgRetweets: number } | null,
): number {
  if (!performance) return 0;
  const baselineScore = baseline
    ? Math.max(1, baseline.avgLikes + (baseline.avgRetweets * 2))
    : 12;
  const lift = (weightedEngagement(performance) - baselineScore) / baselineScore;
  return round(clamp(lift * 0.55, -0.6, 0.8));
}

function addBreakdown(target: RewardBreakdown, delta: Partial<RewardBreakdown>) {
  target.approval += delta.approval || 0;
  target.editBurden += delta.editBurden || 0;
  target.deletionPenalty += delta.deletionPenalty || 0;
  target.postingOutcome += delta.postingOutcome || 0;
  target.copySignal += delta.copySignal || 0;
  target.replyOutcome += delta.replyOutcome || 0;
  target.timeToApproval += delta.timeToApproval || 0;
  target.engagementLift += delta.engagementLift || 0;
}

export function buildOutcomeEpisode({
  agentId,
  tweet,
  signals,
  performance,
  baseline,
}: {
  agentId: string;
  tweet: Tweet;
  signals: LearningSignal[];
  performance?: TweetPerformance;
  baseline?: { avgLikes: number; avgRetweets: number } | null;
}): OutcomeEpisode {
  const breakdown: RewardBreakdown = {
    approval: 0,
    editBurden: 0,
    deletionPenalty: 0,
    postingOutcome: 0,
    copySignal: 0,
    replyOutcome: 0,
    timeToApproval: 0,
    engagementLift: 0,
    immediateTotal: 0,
    delayedTotal: 0,
    total: 0,
    computedAt: new Date().toISOString(),
    notes: [],
  };

  for (const signal of signals) {
    addBreakdown(breakdown, signalBaseReward(signal));
    const latency = latencyReward(signal);
    if (latency !== 0) breakdown.timeToApproval += latency;
    if (signal.reason) breakdown.notes.push(signal.reason);
    if (typeof signal.metadata?.preferenceHint === 'string') breakdown.notes.push(String(signal.metadata.preferenceHint));
  }

  const performanceLift = computePerformanceLiftReward(performance, baseline);
  if (performanceLift !== 0) {
    breakdown.engagementLift += performanceLift;
    breakdown.notes.push(`Performance lift ${performanceLift >= 0 ? '+' : ''}${Math.round(performanceLift * 100)} vs baseline.`);
  }

  breakdown.immediateTotal = round(clamp(
    breakdown.approval +
    breakdown.editBurden +
    breakdown.deletionPenalty +
    breakdown.postingOutcome +
    breakdown.copySignal +
    breakdown.replyOutcome +
    breakdown.timeToApproval
  ));
  breakdown.delayedTotal = round(clamp(breakdown.engagementLift));
  breakdown.total = round(clamp(breakdown.immediateTotal + breakdown.delayedTotal));
  breakdown.notes = [...new Set(breakdown.notes)].slice(0, 8);

  const featureTags: CandidateFeatureTags = tweet.featureTags || extractCandidateFeatureTags(tweet.content, {
    topic: tweet.topic,
    thesisHint: tweet.thesis,
  });

  return {
    agentId,
    tweetId: String(tweet.id),
    xTweetId: tweet.xTweetId || undefined,
    format: tweet.format,
    topic: tweet.topic,
    featureTags,
    reward: breakdown,
    signals: [...new Set(signals.map((signal) => signal.signalType))],
    stage: performance ? 'final' : 'immediate',
    observedAt: performance?.checkedAt || signals[0]?.createdAt || tweet.postedAt || tweet.approvedAt || tweet.createdAt,
  };
}

export function buildOutcomeEpisodes({
  agentId,
  tweets,
  signals,
  performanceHistory,
  baseline,
}: {
  agentId: string;
  tweets: Tweet[];
  signals: LearningSignal[];
  performanceHistory: TweetPerformance[];
  baseline?: { avgLikes: number; avgRetweets: number } | null;
}): OutcomeEpisode[] {
  const signalsByTweetId = new Map<string, LearningSignal[]>();
  for (const signal of signals) {
    if (!signal.tweetId) continue;
    const key = String(signal.tweetId);
    const current = signalsByTweetId.get(key) || [];
    current.push(signal);
    signalsByTweetId.set(key, current);
  }

  const performanceByTweetId = new Map<string, TweetPerformance>();
  for (const entry of performanceHistory) {
    if (!entry.tweetId) continue;
    performanceByTweetId.set(String(entry.tweetId), entry);
  }

  return tweets
    .map((tweet) => buildOutcomeEpisode({
      agentId,
      tweet,
      signals: signalsByTweetId.get(String(tweet.id)) || [],
      performance: performanceByTweetId.get(String(tweet.id)),
      baseline,
    }))
    .filter((episode) => episode.signals.length > 0 || episode.reward.engagementLift !== 0);
}
