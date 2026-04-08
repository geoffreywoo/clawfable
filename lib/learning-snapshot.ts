import type { BanditArmScore, BanditPolicy } from './bandit';
import type {
  AgentLearnings,
  FeedbackEntry,
  LearningSignal,
  PersonalizationMemory,
  ProtocolSettings,
  Tweet,
  TweetPerformance,
} from './types';

type LearningItemSource = 'operator' | 'performance' | 'inferred' | 'bandit';
type LearningItemTone = 'positive' | 'neutral' | 'warning' | 'danger';

export interface LearningBucketItem {
  id: string;
  label: string;
  source: LearningItemSource;
  confidence: number;
  tone: LearningItemTone;
  note?: string;
}

export interface LearningBucket {
  id: string;
  title: string;
  subtitle: string;
  tone: LearningItemTone;
  items: LearningBucketItem[];
}

export interface LearningOverview {
  approvalRate: { currentWeek: number; previousWeek: number };
  deleteRate: { currentWeek: number; previousWeek: number };
  engagementLiftPercent: number | null;
  averageConfidencePercent: number | null;
  autonomyMode: ProtocolSettings['autonomyMode'];
  explorationRate: number;
  activeMix: {
    total: number;
    safe: number;
    balanced: number;
    explore: number;
  };
  trainingSource: BanditPolicy['trainingSource'] | null;
  trainingPulls: number;
  recentSignals: number;
}

export interface LearningExperimentLane {
  id: 'formats' | 'topics' | 'lengths';
  title: string;
  exploit: BanditArmScore | null;
  explore: BanditArmScore | null;
  caution: BanditArmScore | null;
  underTest: BanditArmScore[];
}

export interface LearningEventEntry {
  id: string;
  createdAt: string;
  title: string;
  summary: string;
  learned: string;
  source: LearningItemSource;
  tone: LearningItemTone;
  rewardDelta: number;
  surface: LearningSignal['surface'];
  tweetPreview?: string;
}

export interface LearningSnapshot {
  overview: LearningOverview;
  topRules: string[];
  weeklyChanges: string[];
  beliefState: LearningBucket[];
  experiments: {
    summary: string[];
    lanes: LearningExperimentLane[];
  };
  recentEvents: LearningEventEntry[];
  memory: PersonalizationMemory;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function percentDelta(current: number, previous: number): string {
  const delta = current - previous;
  return `${delta >= 0 ? '+' : ''}${delta}`;
}

function recentWindowSignals(signals: LearningSignal[], startMs: number, endMs?: number): LearningSignal[] {
  return signals.filter((signal) => {
    const ts = new Date(signal.createdAt).getTime();
    return ts >= startMs && (endMs === undefined || ts < endMs);
  });
}

function windowRates(
  signals: LearningSignal[],
  startMs: number,
  tweetsById: Map<string, Tweet>,
  endMs?: number,
) {
  const filtered = recentWindowSignals(signals, startMs, endMs);
  const approvals = filtered.filter((signal) =>
    ['approved_without_edit', 'edited_before_queue', 'edited_before_post', 'reply_posted'].includes(signal.signalType)
  ).length;
  const rejections = filtered.filter((signal) =>
    ['deleted_from_queue', 'deleted_from_x', 'reply_rejected', 'x_post_rejected'].includes(signal.signalType)
  ).length;
  const postSuccesses = filtered.filter((signal) =>
    ['reply_posted', 'x_post_succeeded'].includes(signal.signalType)
  ).length;
  const deletes = filtered.filter((signal) =>
    ['deleted_from_queue', 'deleted_from_x'].includes(signal.signalType)
  ).length;
  const copiedWithoutPost = filtered.filter((signal) => {
    if (signal.signalType !== 'copied_to_clipboard' || !signal.tweetId) return false;
    const tweet = tweetsById.get(String(signal.tweetId));
    return !!tweet && tweet.status !== 'posted';
  }).length;

  return {
    approvals,
    rejections,
    postSuccesses,
    deletes,
    copiedWithoutPost,
    approvalRate: Math.round((approvals / Math.max(1, approvals + rejections)) * 100),
    deleteRate: Math.round((deletes / Math.max(1, deletes + postSuccesses)) * 100),
  };
}

function averageConfidence(tweets: Tweet[]): number | null {
  const scored = tweets
    .map((tweet) => tweet.confidenceScore)
    .filter((value): value is number => typeof value === 'number');

  if (scored.length === 0) return null;
  return Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 100);
}

function activeMix(tweets: Tweet[]) {
  const live = tweets.filter((tweet) => ['preview', 'draft', 'queued'].includes(tweet.status)).slice(0, 30);
  return {
    total: live.length,
    safe: live.filter((tweet) => tweet.generationMode === 'safe').length,
    balanced: live.filter((tweet) => tweet.generationMode === 'balanced').length,
    explore: live.filter((tweet) => tweet.generationMode === 'explore').length,
  };
}

function buildBucketItem(
  id: string,
  label: string,
  source: LearningItemSource,
  tone: LearningItemTone,
  confidence: number,
  note?: string,
): LearningBucketItem {
  return {
    id,
    label,
    source,
    tone,
    confidence: Math.round(clamp(confidence) * 100),
    note,
  };
}

function matchFeedbackSource(label: string, feedback: FeedbackEntry[]): { source: LearningItemSource; note?: string; confidence: number } {
  const normalized = label.toLowerCase();
  const matched = feedback.find((entry) => {
    const candidate = `${entry.intentSummary || ''} ${entry.reason || ''}`.toLowerCase();
    return candidate.includes(normalized) || normalized.includes(candidate.trim());
  });

  if (!matched) {
    return { source: 'performance', confidence: 0.72 };
  }

  if (matched.userProvidedReason) {
    return { source: 'operator', confidence: 0.92, note: 'directly stated by operator' };
  }

  return { source: 'inferred', confidence: 0.74, note: 'inferred from delete behavior' };
}

function buildBeliefState(
  memory: PersonalizationMemory,
  feedback: FeedbackEntry[],
): LearningBucket[] {
  const buckets: LearningBucket[] = [
    {
      id: 'always',
      title: 'DO MORE',
      subtitle: 'Behavior the system is leaning into',
      tone: 'positive',
      items: memory.alwaysDoMoreOfThis.map((item, index) =>
        buildBucketItem(`always-${index}`, item, 'performance', 'positive', 0.86, 'backed by performance history')
      ),
    },
    {
      id: 'never',
      title: 'AVOID',
      subtitle: 'Patterns the operator keeps pushing away',
      tone: 'danger',
      items: memory.neverDoThisAgain.map((item, index) => {
        const matched = matchFeedbackSource(item, feedback);
        return buildBucketItem(`never-${index}`, item, matched.source, 'danger', matched.confidence, matched.note);
      }),
    },
    {
      id: 'momentum',
      title: 'TOPICS WITH MOMENTUM',
      subtitle: 'Where audience response is rising right now',
      tone: 'positive',
      items: memory.topicsWithMomentum.map((item, index) =>
        buildBucketItem(`momentum-${index}`, item, 'performance', 'positive', 0.8, 'outperforming recent baseline')
      ),
    },
    {
      id: 'under-tested',
      title: 'FORMATS UNDER TEST',
      subtitle: 'Experiments that need more volume before the system commits',
      tone: 'warning',
      items: memory.formatsUnderTested.map((item, index) =>
        buildBucketItem(`under-${index}`, item, 'bandit', 'warning', 0.62, 'low sample size')
      ),
    },
    {
      id: 'preferences',
      title: 'HIDDEN PREFERENCES',
      subtitle: 'Things operator behavior implies even if never said aloud',
      tone: 'neutral',
      items: memory.operatorHiddenPreferences.map((item, index) =>
        buildBucketItem(`preference-${index}`, item, 'operator', 'neutral', 0.78, 'derived from edits and remixes')
      ),
    },
    {
      id: 'identity',
      title: 'IDENTITY CONSTRAINTS',
      subtitle: 'Permanent voice boundaries the model should not cross',
      tone: 'neutral',
      items: memory.identityConstraints.map((item, index) =>
        buildBucketItem(`identity-${index}`, item, 'operator', 'neutral', 0.94, 'treated as durable rule')
      ),
    },
  ];

  return buckets.filter((bucket) => bucket.items.length > 0);
}

function sortExploit(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.meanReward - a.meanReward || b.pulls - a.pulls || b.ucbScore - a.ucbScore || a.arm.localeCompare(b.arm)
  );
}

function sortExplore(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    Number(b.coldStart) - Number(a.coldStart) ||
    b.explorationBonus - a.explorationBonus ||
    b.ucbScore - a.ucbScore ||
    a.arm.localeCompare(b.arm)
  );
}

function sortCaution(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.failures - a.failures || a.meanReward - b.meanReward || a.arm.localeCompare(b.arm)
  );
}

function buildExperimentLanes(policy: BanditPolicy | null): LearningExperimentLane[] {
  if (!policy) return [];

  const groups: Array<{ id: LearningExperimentLane['id']; title: string; arms: BanditArmScore[] }> = [
    { id: 'formats', title: 'FORMATS', arms: policy.formatArms },
    { id: 'topics', title: 'TOPICS', arms: policy.topicArms },
    { id: 'lengths', title: 'LENGTH', arms: policy.lengthArms },
  ];

  return groups.map(({ id, title, arms }) => ({
    id,
    title,
    exploit: sortExploit(arms)[0] || null,
    explore: sortExplore(arms)[0] || null,
    caution: sortCaution(arms.filter((arm) => arm.pulls >= 2))[0] || null,
    underTest: sortExplore(arms).filter((arm) => arm.coldStart || arm.pulls < 3).slice(0, 3),
  }));
}

function summarizeSignalEvent(signal: LearningSignal, tweet: Tweet | undefined): Omit<LearningEventEntry, 'id' | 'createdAt'> {
  const tweetPreview = tweet?.content;
  const preview = tweetPreview ? `"${tweetPreview.slice(0, 96)}${tweetPreview.length > 96 ? '...' : ''}"` : undefined;
  const learnedFromReason = signal.reason || (typeof signal.metadata?.preferenceHint === 'string' ? signal.metadata.preferenceHint : null);

  switch (signal.signalType) {
    case 'approved_without_edit':
      return {
        title: 'Approved Cleanly',
        summary: `A draft moved forward without edits${preview ? `: ${preview}` : ''}.`,
        learned: 'The baseline voice is getting closer to what the operator wants.',
        source: 'operator',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'edited_before_queue':
    case 'edited_before_post':
      return {
        title: 'Edited Before Approval',
        summary: preview ? `Operator reshaped ${preview}.` : 'Operator reshaped a draft before approval.',
        learned: learnedFromReason || 'Edits are being mined into hidden-preference memory.',
        source: 'operator',
        tone: 'warning',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'deleted_from_queue':
      return {
        title: 'Removed From Queue',
        summary: preview ? `A queued draft was rejected: ${preview}.` : 'A queued draft was rejected.',
        learned: learnedFromReason || 'Avoid similar takes going forward.',
        source: signal.inferred ? 'inferred' : 'operator',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'deleted_from_x':
      return {
        title: 'Deleted After Posting',
        summary: preview ? `A live post was removed from X: ${preview}.` : 'A live post was removed from X.',
        learned: learnedFromReason || 'This is a strong negative signal for future ranking.',
        source: signal.inferred ? 'inferred' : 'operator',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'copied_to_clipboard':
      return {
        title: 'Copied Out',
        summary: preview ? `A draft was copied externally: ${preview}.` : 'A draft was copied externally.',
        learned: 'Useful signal, but weaker than an approval or a post.',
        source: 'operator',
        tone: 'neutral',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'reply_rejected':
      return {
        title: 'Reply Rejected',
        summary: 'A generated reply was not accepted.',
        learned: learnedFromReason || 'Reply voice or relevance missed the mark.',
        source: signal.inferred ? 'inferred' : 'operator',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'reply_posted':
      return {
        title: 'Reply Posted',
        summary: 'A generated reply made it live.',
        learned: 'Reply behavior on this surface is being reinforced.',
        source: 'performance',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'x_post_rejected':
      return {
        title: 'Post Rejected',
        summary: preview ? `A draft hit a posting block: ${preview}.` : 'A draft hit a posting block.',
        learned: learnedFromReason || 'Risk and rejection patterns feed quarantine logic.',
        source: 'performance',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    case 'x_post_succeeded':
      return {
        title: 'Posted Successfully',
        summary: preview ? `A generated tweet went live: ${preview}.` : 'A generated tweet went live.',
        learned: 'Delivery confidence increases for similar candidates.',
        source: 'performance',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
    default:
      return {
        title: signal.signalType.replace(/_/g, ' '),
        summary: learnedFromReason || 'A learning event was captured.',
        learned: learnedFromReason || 'This signal is now part of future ranking and memory.',
        source: signal.inferred ? 'inferred' : 'performance',
        tone: signal.rewardDelta >= 0 ? 'positive' : 'warning',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        tweetPreview,
      };
  }
}

function buildRecentEvents(signals: LearningSignal[], allTweets: Tweet[]): LearningEventEntry[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  return signals.slice(0, 16).map((signal) => {
    const event = summarizeSignalEvent(signal, signal.tweetId ? tweetById.get(String(signal.tweetId)) : undefined);
    return {
      id: signal.id,
      createdAt: signal.createdAt,
      ...event,
    };
  });
}

function computeLift(performanceHistory: TweetPerformance[], baseline?: { avgLikes: number; avgRetweets: number } | null): number | null {
  if (!baseline || baseline.avgLikes <= 0) return null;
  const cutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);
  const recent = performanceHistory.filter((entry) => new Date(entry.postedAt).getTime() >= cutoff);
  if (recent.length === 0) return null;
  const avgLikes = recent.reduce((sum, entry) => sum + (entry.likes || 0), 0) / recent.length;
  return Math.round(((avgLikes - baseline.avgLikes) / baseline.avgLikes) * 100);
}

export interface BuildLearningSnapshotOptions {
  settings: ProtocolSettings;
  learnings: AgentLearnings | null;
  memory: PersonalizationMemory;
  banditPolicy: BanditPolicy | null;
  signals: LearningSignal[];
  feedback: FeedbackEntry[];
  allTweets: Tweet[];
  performanceHistory: TweetPerformance[];
  baseline?: { avgLikes: number; avgRetweets: number } | null;
}

export function buildLearningSnapshot({
  settings,
  learnings,
  memory,
  banditPolicy,
  signals,
  feedback,
  allTweets,
  performanceHistory,
  baseline,
}: BuildLearningSnapshotOptions): LearningSnapshot {
  const nowMs = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const currentWeek = windowRates(signals, nowMs - sevenDays, tweetById);
  const previousWeek = windowRates(signals, nowMs - (sevenDays * 2), tweetById, nowMs - sevenDays);
  const liveTweets = allTweets.filter((tweet) => ['preview', 'draft', 'queued'].includes(tweet.status));
  const averageConfidencePercent = averageConfidence(liveTweets);

  return {
    overview: {
      approvalRate: {
        currentWeek: currentWeek.approvalRate,
        previousWeek: previousWeek.approvalRate,
      },
      deleteRate: {
        currentWeek: currentWeek.deleteRate,
        previousWeek: previousWeek.deleteRate,
      },
      engagementLiftPercent: computeLift(performanceHistory, baseline),
      averageConfidencePercent,
      autonomyMode: settings.autonomyMode,
      explorationRate: settings.explorationRate,
      activeMix: activeMix(allTweets),
      trainingSource: banditPolicy?.trainingSource || null,
      trainingPulls: banditPolicy?.totalPulls || 0,
      recentSignals: recentWindowSignals(signals, nowMs - sevenDays).length,
    },
    topRules: [
      ...(memory.alwaysDoMoreOfThis || []),
      ...(memory.operatorHiddenPreferences || []),
      ...(learnings?.insights || []),
    ].slice(0, 6),
    weeklyChanges: [
      ...memory.weeklyChanges,
      `Approval rate ${percentDelta(currentWeek.approvalRate, previousWeek.approvalRate)} pts vs last week.`,
      `Delete rate ${percentDelta(currentWeek.deleteRate, previousWeek.deleteRate)} pts vs last week.`,
    ].slice(0, 6),
    beliefState: buildBeliefState(memory, feedback),
    experiments: {
      summary: banditPolicy?.summary || [],
      lanes: buildExperimentLanes(banditPolicy),
    },
    recentEvents: buildRecentEvents(signals, allTweets),
    memory,
  };
}
