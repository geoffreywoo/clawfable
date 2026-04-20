import type { BanditArmScore, BanditPolicy } from './bandit';
import type {
  AgentLearnings,
  ContentSourceLane,
  FeedbackEntry,
  LearningSignal,
  ManualExampleCuration,
  OutcomeEpisode,
  PersonalizationMemory,
  ProtocolSettings,
  Tweet,
  TweetPerformance,
} from './types';
import { buildOutcomeEpisodes } from './outcome-rewards';
import type { EnrichedTrendingTopic, SourcePlannerPlan } from './source-planner';

type LearningItemSource = 'operator' | 'performance' | 'inferred' | 'bandit';
type LearningItemTone = 'positive' | 'neutral' | 'warning' | 'danger';
export type LearningStatusState = 'improving' | 'stable' | 'regressing' | 'under_test' | 'low_confidence' | 'waiting';
export type LearningEventGroup = 'approvals' | 'misses' | 'performance' | 'policy';

const APPROVAL_SIGNAL_TYPES = new Set(['approved_without_edit', 'edited_before_queue', 'edited_before_post', 'reply_posted']);
const EDIT_SIGNAL_TYPES = new Set(['edited_before_queue', 'edited_before_post']);
const REJECTION_SIGNAL_TYPES = new Set(['deleted_from_queue', 'deleted_from_x', 'reply_rejected', 'x_post_rejected']);
const DELETE_SIGNAL_TYPES = new Set(['deleted_from_queue', 'deleted_from_x']);
const POST_SIGNAL_TYPES = new Set(['reply_posted', 'x_post_succeeded']);
const LIVE_TWEET_STATUSES = new Set(['preview', 'draft', 'queued']);

export interface LearningBucketItem {
  id: string;
  label: string;
  lesson: string;
  impact: string;
  source: LearningItemSource;
  confidence: number;
  tone: LearningItemTone;
  note?: string;
}

export interface LearningBucket {
  id: 'always' | 'never' | 'momentum' | 'identity';
  title: string;
  subtitle: string;
  howToRead: string;
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
  localEvidenceWeight: number;
  globalPriorWeight: number;
  recentSignals: number;
}

export interface LearningScoreboardCard {
  id: 'approval_rate' | 'edit_before_approval_rate' | 'delete_rate' | 'engagement_lift' | 'queue_quality' | 'learning_velocity';
  label: string;
  currentValue: number;
  previousValue: number;
  delta: number;
  unit: 'percent' | 'score' | 'count';
  interpretation: string;
  series: number[];
  tone: LearningItemTone;
}

export interface LearningScoreboard {
  state: Extract<LearningStatusState, 'improving' | 'stable' | 'regressing'>;
  headline: string;
  explanation: string;
  cards: LearningScoreboardCard[];
}

export interface LearningExperimentLane {
  id: 'formats' | 'topics' | 'lengths' | 'hooks' | 'tones' | 'specificity' | 'structure';
  title: string;
  belief: string;
  hypothesis: string;
  nextCheck: string;
  provenance: string;
  confidence: number;
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
  group: LearningEventGroup;
  tweetPreview?: string;
}

export interface LearningWeekPoint {
  label: string;
  approvalRate: number;
  editBeforeApprovalRate: number;
  editBurden: number;
  deleteRate: number;
  deleteFromX: number;
  engagementLift: number;
  queueQuality: number;
  learningVelocity: number;
  keptLiveRate: number;
  medianTimeToApproval: number;
  calibration: number;
}

export interface LearningMetricSummary {
  currentWeek: number;
  previousWeek: number;
  delta: number;
  interpretation: string;
  series: number[];
}

export interface LearningCalibrationSummary {
  currentWeek: number;
  previousWeek: number;
  delta: number;
  interpretation: string;
  series: number[];
}

export interface LearningFunnel {
  generated: number;
  approved: number;
  posted: number;
  keptLive: number;
  outperformedBaseline: number;
}

export interface LearningNarrativeItem {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  tone: LearningItemTone;
  state: LearningStatusState;
  impact: number;
}

export interface LearningDecisionInsight {
  tweetId: string;
  state: LearningStatusState;
  predictedLabel: string;
  predictedScore: number | null;
  actualLabel: string | null;
  actualScore: number | null;
  learningDelta: number | null;
  learned: string;
  influencingLessons: string[];
  influencingHypotheses: string[];
  evidence: string[];
}

export interface LearningPlannerLaneCard {
  lane: ContentSourceLane;
  plannedSlots: number;
  posts: number;
  avgEngagement: number;
  wins: number;
}

export interface LearningTrendPlannerItem {
  id: string;
  category: string;
  headline: string;
  lane: string;
  fit: number;
  reason: string;
}

export interface LearningManualExampleItem {
  xTweetId: string;
  content: string;
  likes: number;
  pinned: boolean;
  blocked: boolean;
}

export interface LearningPlannerPreview {
  trendMixTarget: number;
  trendTolerance: string;
  nextBatchMix: LearningPlannerLaneCard[];
  acceptedTrends: LearningTrendPlannerItem[];
  rejectedTrends: LearningTrendPlannerItem[];
  manualExamples: {
    pinnedCount: number;
    blockedCount: number;
    topicClusters: Array<{ topic: string; angle: string; sampleCount: number; avgEngagement: number }>;
    examples: LearningManualExampleItem[];
  };
}

export interface LearningSnapshot {
  overview: LearningOverview;
  scoreboard: LearningScoreboard;
  topRules: string[];
  weeklyChanges: string[];
  weeklySeries: LearningWeekPoint[];
  beliefState: LearningBucket[];
  experiments: {
    summary: string[];
    lanes: LearningExperimentLane[];
  };
  recentEvents: LearningEventEntry[];
  memory: PersonalizationMemory;
  learningVelocity: LearningMetricSummary;
  queueQuality: LearningMetricSummary;
  calibration: LearningCalibrationSummary;
  funnel: LearningFunnel;
  topImprovements: LearningNarrativeItem[];
  topRegressions: LearningNarrativeItem[];
  policyChanges: LearningNarrativeItem[];
  decisionInsights: Record<string, LearningDecisionInsight>;
  planner: LearningPlannerPreview;
}

interface WindowMetrics {
  label: string;
  approvalRate: number;
  editBeforeApprovalRate: number;
  editBurden: number;
  deleteRate: number;
  engagementLift: number;
  queueQuality: number;
  learningVelocity: number;
  keptLiveRate: number;
  medianTimeToApproval: number;
  calibration: number;
  approvals: number;
  rejections: number;
  edits: number;
  generated: number;
  posted: number;
  keptLive: number;
  outperformedBaseline: number;
  deleteFromX: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 0): number {
  return Number(value.toFixed(digits));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function weightedEngagement(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return entry.likes + (entry.retweets * 2) + (entry.replies * 1.5);
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function inWindow(iso: string | null | undefined, startMs: number, endMs?: number): boolean {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  return ts >= startMs && (endMs === undefined || ts < endMs);
}

function averageConfidence(tweets: Tweet[]): number | null {
  const scored = tweets
    .map((tweet) => tweet.confidenceScore)
    .filter((value): value is number => typeof value === 'number');

  if (scored.length === 0) return null;
  return Math.round(average(scored) * 100);
}

function activeMix(tweets: Tweet[]) {
  const live = tweets.filter((tweet) => LIVE_TWEET_STATUSES.has(tweet.status)).slice(0, 30);
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
  lesson: string,
  impact: string,
  source: LearningItemSource,
  tone: LearningItemTone,
  confidence: number,
  note?: string,
): LearningBucketItem {
  return {
    id,
    label,
    lesson,
    impact,
    source,
    tone,
    confidence: Math.round(clamp(confidence) * 100),
    note,
  };
}

function containsAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}

function sentenceCaseArm(value: string): string {
  return value.replace(/_/g, ' ');
}

function explainAvoidItem(label: string): { lesson: string; impact: string } {
  const normalized = label.toLowerCase();

  if (containsAny(normalized, ['generic', 'vague', 'abstract'])) {
    return {
      lesson: 'Specificity is winning over abstraction.',
      impact: 'Similar vague drafts get downranked unless they add sharper claims, examples, or numbers.',
    };
  }

  if (containsAny(normalized, ['aggressive', 'hostile', 'harsh', 'mean', 'too spicy'])) {
    return {
      lesson: 'The voice can keep its edge without sounding needlessly combative.',
      impact: 'Ranking and generation will steer away from hostility-first phrasing on future drafts.',
    };
  }

  if (containsAny(normalized, ['salesy', 'promotional', 'promo', 'shill', 'marketing'])) {
    return {
      lesson: 'Insight has to come before promotion.',
      impact: 'Drafts that read like marketing copy get penalized unless they earn the pitch with a real point of view.',
    };
  }

  if (containsAny(normalized, ['off-topic', 'wrong topic', 'not on-topic', 'off brand', 'off-brand'])) {
    return {
      lesson: 'The account needs tighter topical alignment.',
      impact: 'Future drafts get pushed back toward core subjects and away from tangents that do not fit the account.',
    };
  }

  if (containsAny(normalized, ['wrong tone', 'not my voice', 'off voice', 'off-voice', 'forced', 'cringe', 'corny'])) {
    return {
      lesson: 'Voice fit matters more than novelty.',
      impact: 'Similar phrasing becomes a negative prior, so future drafts are nudged closer to the native voice before experimenting.',
    };
  }

  if (containsAny(normalized, ['factually wrong', 'inaccurate', 'made up', 'incorrect'])) {
    return {
      lesson: 'The system needs a higher bar for claims that sound authoritative.',
      impact: 'Riskier assertions get penalized in ranking and are more likely to be quarantined before posting.',
    };
  }

  if (containsAny(normalized, ['weak hook', 'boring', 'flat opening', 'no hook'])) {
    return {
      lesson: 'The first line needs more tension, surprise, or curiosity.',
      impact: 'Future drafts are pushed toward stronger openers before they can score well.',
    };
  }

  if (containsAny(normalized, ['too long', 'rambling', 'wordy'])) {
    return {
      lesson: 'Compression is improving approval odds.',
      impact: 'Longer drafts like this lose ranking weight unless the extra depth clearly pays off.',
    };
  }

  if (containsAny(normalized, ['too short', 'thin', 'not enough depth', 'underdeveloped'])) {
    return {
      lesson: 'Some ideas need a more developed argument before they feel publishable.',
      impact: 'Future drafts on similar topics can get nudged toward fuller structure instead of one-line takes.',
    };
  }

  if (containsAny(normalized, ['repetitive', 'duplicate', 'same take', 'repeated'])) {
    return {
      lesson: 'Novelty is part of the quality bar, not just topical fit.',
      impact: 'The chooser applies stronger repetition penalties to similar drafts going forward.',
    };
  }

  return {
    lesson: 'This pattern is being treated as a negative voice signal.',
    impact: 'Similar drafts get penalized during generation, ranking, and safety checks until newer evidence proves otherwise.',
  };
}

function explainBucketItem(bucketId: LearningBucket['id'], label: string): { lesson: string; impact: string } {
  switch (bucketId) {
    case 'always':
      return {
        lesson: label,
        impact: 'This lesson increases exposure for similar drafts during generation and ranking.',
      };
    case 'never':
      return explainAvoidItem(label);
    case 'momentum':
      return {
        lesson: `${label} is outperforming the recent baseline right now.`,
        impact: 'The generator and ranker both allocate more surface area toward this topic while momentum lasts.',
      };
    case 'identity':
      return {
        lesson: label,
        impact: 'This acts like a durable voice boundary. Drafts that conflict with it should score worse or be rewritten.',
      };
    default:
      return {
        lesson: label,
        impact: 'This signal now influences future ranking and generation.',
      };
  }
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
  const doMoreItems = [
    ...memory.alwaysDoMoreOfThis.map((item, index) => {
      const detail = explainBucketItem('always', item);
      return buildBucketItem(`always-${index}`, item, detail.lesson, detail.impact, 'performance', 'positive', 0.86, 'backed by performance history');
    }),
    ...memory.operatorHiddenPreferences.map((item, index) => {
      const detail = explainBucketItem('always', item);
      return buildBucketItem(`preference-${index}`, item, detail.lesson, detail.impact, 'operator', 'neutral', 0.78, 'derived from edits and remixes');
    }),
  ];

  const buckets: LearningBucket[] = [
    {
      id: 'always',
      title: 'DO MORE OF THIS',
      subtitle: 'Patterns the system is leaning into',
      howToRead: 'These are the strongest positive lessons currently shaping drafting and ranking.',
      tone: 'positive',
      items: doMoreItems,
    },
    {
      id: 'never',
      title: 'AVOID THIS',
      subtitle: 'Patterns the operator keeps pushing away',
      howToRead: 'These are translated into negative ranking pressure, prompt constraints, and stronger caution checks.',
      tone: 'danger',
      items: memory.neverDoThisAgain.map((item, index) => {
        const matched = matchFeedbackSource(item, feedback);
        const detail = explainBucketItem('never', item);
        return buildBucketItem(`never-${index}`, item, detail.lesson, detail.impact, matched.source, 'danger', matched.confidence, matched.note);
      }),
    },
    {
      id: 'momentum',
      title: 'TOPICS WITH MOMENTUM',
      subtitle: 'Where audience response is rising right now',
      howToRead: 'Momentum topics are temporary demand signals. They increase exposure while the audience is responding.',
      tone: 'positive',
      items: memory.topicsWithMomentum.map((item, index) => {
        const detail = explainBucketItem('momentum', item);
        return buildBucketItem(`momentum-${index}`, item, detail.lesson, detail.impact, 'performance', 'positive', 0.8, 'outperforming recent baseline');
      }),
    },
    {
      id: 'identity',
      title: 'IDENTITY GUARDRAILS',
      subtitle: 'Permanent voice boundaries the model should not cross',
      howToRead: 'These are treated as durable rules and should stay true even while the system experiments elsewhere.',
      tone: 'neutral',
      items: memory.identityConstraints.map((item, index) => {
        const detail = explainBucketItem('identity', item);
        return buildBucketItem(`identity-${index}`, item, detail.lesson, detail.impact, 'operator', 'neutral', 0.94, 'treated as durable rule');
      }),
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
    { id: 'formats', title: 'Formats', arms: policy.formatArms },
    { id: 'topics', title: 'Topics', arms: policy.topicArms },
    { id: 'lengths', title: 'Length', arms: policy.lengthArms },
    { id: 'hooks', title: 'Hooks', arms: policy.hookArms },
    { id: 'tones', title: 'Tone', arms: policy.toneArms },
    { id: 'specificity', title: 'Specificity', arms: policy.specificityArms },
    { id: 'structure', title: 'Structure', arms: policy.structureArms },
  ];

  return groups.map(({ id, title, arms }) => {
    const exploit = sortExploit(arms)[0] || null;
    const explore = sortExplore(arms)[0] || null;
    const caution = sortCaution(arms.filter((arm) => arm.pulls >= 2))[0] || null;
    const underTest = sortExplore(arms).filter((arm) => arm.coldStart || arm.pulls < 3).slice(0, 3);
    const belief = exploit
      ? `${title} winner: ${sentenceCaseArm(exploit.arm)} is the strongest bet right now.`
      : `${title} does not have a clear winner yet.`;
    const hypothesis = explore
      ? `The system is testing whether ${sentenceCaseArm(explore.arm)} can beat ${sentenceCaseArm(exploit?.arm || 'the current default')}.`
      : `The system is still looking for a meaningful challenger in ${title.toLowerCase()}.`;
    const nextCheck = underTest.length > 0
      ? `A policy change needs more evidence on ${underTest.map((arm) => sentenceCaseArm(arm.arm)).join(', ')}.`
      : caution
        ? `${sentenceCaseArm(caution.arm)} needs a better reward profile before the policy widens again.`
        : 'The policy stays open until clearer evidence arrives.';
    const provenance = exploit
      ? exploit.source === 'local_evidence'
        ? `Mostly local evidence (${Math.round(exploit.localShare * 100)}% local share).`
        : exploit.source === 'global_prior'
          ? 'Still mostly driven by shared cold-start prior.'
          : `Mixed evidence: ${Math.round(exploit.localShare * 100)}% local and ${Math.round((1 - exploit.localShare) * 100)}% shared prior.`
      : 'No leading arm yet.';
    const confidence = exploit
      ? Math.round(clamp((exploit.meanReward * 0.7) + ((1 - exploit.uncertainty) * 0.3)) * 100)
      : 0;

    return {
      id,
      title,
      belief,
      hypothesis,
      nextCheck,
      provenance,
      confidence,
      exploit,
      explore,
      caution,
      underTest,
    };
  });
}

function summarizeSignalEvent(signal: LearningSignal, tweet: Tweet | undefined): Omit<LearningEventEntry, 'id' | 'createdAt'> {
  const tweetPreview = tweet?.content;
  const preview = tweetPreview ? `"${tweetPreview.slice(0, 96)}${tweetPreview.length > 96 ? '...' : ''}"` : undefined;
  const learnedFromReason = signal.reason || (typeof signal.metadata?.preferenceHint === 'string' ? signal.metadata.preferenceHint : null);

  switch (signal.signalType) {
    case 'approved_without_edit':
      return {
        title: 'Approved cleanly',
        summary: `A draft moved forward without edits${preview ? `: ${preview}` : ''}.`,
        learned: 'The baseline voice is getting closer to what the operator wants.',
        source: 'operator',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'approvals',
        tweetPreview,
      };
    case 'edited_before_queue':
    case 'edited_before_post':
      return {
        title: 'Edited before approval',
        summary: preview ? `Operator reshaped ${preview}.` : 'Operator reshaped a draft before approval.',
        learned: learnedFromReason || 'Edits are being mined into hidden-preference memory.',
        source: 'operator',
        tone: 'warning',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'approvals',
        tweetPreview,
      };
    case 'deleted_from_queue':
      return {
        title: 'Removed from queue',
        summary: preview ? `A queued draft was rejected: ${preview}.` : 'A queued draft was rejected.',
        learned: learnedFromReason || 'Avoid similar takes going forward.',
        source: signal.inferred ? 'inferred' : 'operator',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'misses',
        tweetPreview,
      };
    case 'deleted_from_x':
      return {
        title: 'Deleted after posting',
        summary: preview ? `A live post was removed from X: ${preview}.` : 'A live post was removed from X.',
        learned: learnedFromReason || 'This is a strong negative signal for future ranking.',
        source: signal.inferred ? 'inferred' : 'operator',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'misses',
        tweetPreview,
      };
    case 'copied_to_clipboard':
      return {
        title: 'Copied out',
        summary: preview ? `A draft was copied externally: ${preview}.` : 'A draft was copied externally.',
        learned: 'Useful signal, but weaker than an approval or a post.',
        source: 'operator',
        tone: 'neutral',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'approvals',
        tweetPreview,
      };
    case 'reply_rejected':
      return {
        title: 'Reply rejected',
        summary: 'A generated reply was not accepted.',
        learned: learnedFromReason || 'Reply voice or relevance missed the mark.',
        source: signal.inferred ? 'inferred' : 'operator',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'misses',
        tweetPreview,
      };
    case 'reply_posted':
      return {
        title: 'Reply posted',
        summary: 'A generated reply made it live.',
        learned: 'Reply behavior on this surface is being reinforced.',
        source: 'performance',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'performance',
        tweetPreview,
      };
    case 'tweet_liked':
      return {
        title: 'Tweet liked',
        summary: 'A supervised Engage like completed successfully.',
        learned: 'This target class is currently a safe engagement lane.',
        source: 'performance',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'performance',
        tweetPreview,
      };
    case 'tweet_like_failed':
      return {
        title: 'Like failed',
        summary: 'A supervised Engage like hit a browser or platform failure.',
        learned: learnedFromReason || 'The operator may need to retry once the browser state is healthy again.',
        source: 'performance',
        tone: 'warning',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'policy',
        tweetPreview,
      };
    case 'x_post_rejected':
      return {
        title: 'Post rejected',
        summary: preview ? `A draft hit a posting block: ${preview}.` : 'A draft hit a posting block.',
        learned: learnedFromReason || 'Risk and rejection patterns feed caution logic.',
        source: 'performance',
        tone: 'danger',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'misses',
        tweetPreview,
      };
    case 'x_post_succeeded':
      return {
        title: 'Posted successfully',
        summary: preview ? `A generated tweet went live: ${preview}.` : 'A generated tweet went live.',
        learned: 'Delivery confidence increases for similar candidates.',
        source: 'performance',
        tone: 'positive',
        rewardDelta: signal.rewardDelta,
        surface: signal.surface,
        group: 'performance',
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
        group: 'performance',
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

function buildOutcomeEventEntries(episodes: OutcomeEpisode[], allTweets: Tweet[]): LearningEventEntry[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  return episodes
    .slice()
    .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
    .slice(0, 10)
    .map((episode) => {
      const tweet = tweetById.get(String(episode.tweetId));
      return {
        id: `episode:${episode.tweetId}`,
        createdAt: episode.observedAt,
        title: episode.reward.total >= 0 ? 'Performance settled above expectation' : 'Performance settled below expectation',
        summary: `Composite reward updated to ${episode.reward.total >= 0 ? '+' : ''}${episode.reward.total.toFixed(2)}.`,
        learned: episode.reward.notes[0] || 'This reward episode now affects feature-level ranking and experimentation.',
        source: 'performance',
        tone: episode.reward.total >= 0 ? 'positive' : 'warning',
        rewardDelta: episode.reward.total,
        surface: 'cron',
        group: 'performance',
        tweetPreview: tweet?.content,
      };
    });
}

function computeLift(
  performanceHistory: TweetPerformance[],
  baseline?: { avgLikes: number; avgRetweets: number } | null,
): number | null {
  if (!baseline) return null;
  const baselineScore = Math.max(1, baseline.avgLikes + (baseline.avgRetweets * 2));
  if (performanceHistory.length === 0) return null;
  const avgScore = average(performanceHistory.map(weightedEngagement));
  return Math.round(((avgScore - baselineScore) / baselineScore) * 100);
}

function computeQueueQualityScore(
  tweets: Tweet[],
  settings: ProtocolSettings,
  approvalRate: number,
): number {
  const activeTweets = tweets.filter((tweet) => LIVE_TWEET_STATUSES.has(tweet.status));
  if (activeTweets.length === 0) return 0;

  const confidence = average(activeTweets.map((tweet) => typeof tweet.confidenceScore === 'number' ? tweet.confidenceScore : 0.58));
  const safety = average(activeTweets.map((tweet) => {
    const repetitionSafety = typeof tweet.repetitionRiskScore === 'number' ? 1 - tweet.repetitionRiskScore : 0.68;
    const policySafety = typeof tweet.policyRiskScore === 'number' ? 1 - tweet.policyRiskScore : 0.72;
    return average([repetitionSafety, policySafety]);
  }));
  const density = clamp(activeTweets.length / Math.max(settings.minQueueSize || 1, 1));
  const quarantinePenalty = activeTweets.filter((tweet) => Boolean(tweet.quarantinedAt)).length / Math.max(activeTweets.length, 1);
  const score = clamp(
    (confidence * 0.32) +
    (safety * 0.26) +
    ((approvalRate / 100) * 0.24) +
    (density * 0.18) -
    (quarantinePenalty * 0.2)
  );

  return Math.round(score * 100);
}

function getPredictedOutcomeValue(tweet: Tweet): number | null {
  if (typeof tweet.rewardPrediction === 'number') return clamp(tweet.rewardPrediction);
  if (typeof tweet.confidenceScore === 'number') return clamp(tweet.confidenceScore);
  if (typeof tweet.candidateScore === 'number') return clamp(tweet.candidateScore / 100);
  return null;
}

function computeCalibrationScore(episodes: OutcomeEpisode[], tweets: Map<string, Tweet>): number {
  const comparable = episodes
    .map((episode) => {
      const tweet = tweets.get(String(episode.tweetId));
      if (!tweet) return null;
      const predicted = getPredictedOutcomeValue(tweet);
      if (predicted === null) return null;
      const actual = clamp((episode.reward.total + 1) / 2);
      return Math.abs(predicted - actual);
    })
    .filter((value): value is number => value !== null);

  if (comparable.length < 2) return 0;
  const mae = average(comparable);
  return Math.round((1 - clamp(mae)) * 100);
}

function buildWindowMetrics({
  label,
  startMs,
  endMs,
  signals,
  allTweets,
  performanceHistory,
  settings,
  baseline,
  outcomeEpisodes,
  tweetById,
}: {
  label: string;
  startMs: number;
  endMs?: number;
  signals: LearningSignal[];
  allTweets: Tweet[];
  performanceHistory: TweetPerformance[];
  settings: ProtocolSettings;
  baseline?: { avgLikes: number; avgRetweets: number } | null;
  outcomeEpisodes: OutcomeEpisode[];
  tweetById: Map<string, Tweet>;
}): WindowMetrics {
  const filteredSignals = recentWindowSignals(signals, startMs, endMs);
  const approvalSignals = filteredSignals.filter((signal) => APPROVAL_SIGNAL_TYPES.has(signal.signalType));
  const editSignals = filteredSignals.filter((signal) => EDIT_SIGNAL_TYPES.has(signal.signalType));
  const rejectionSignals = filteredSignals.filter((signal) => REJECTION_SIGNAL_TYPES.has(signal.signalType));
  const deleteSignals = filteredSignals.filter((signal) => DELETE_SIGNAL_TYPES.has(signal.signalType));
  const deleteFromXSignals = filteredSignals.filter((signal) => signal.signalType === 'deleted_from_x');
  const postSignals = filteredSignals.filter((signal) => signal.signalType === 'x_post_succeeded');
  const generatedTweets = allTweets.filter((tweet) => inWindow(tweet.createdAt, startMs, endMs));
  const liveWindowTweets = generatedTweets.length > 0 ? generatedTweets : allTweets.filter((tweet) => LIVE_TWEET_STATUSES.has(tweet.status));
  const approvalCount = approvalSignals.length;
  const rejectionCount = rejectionSignals.length;
  const postCount = postSignals.length;
  const deleteCount = deleteSignals.length;
  const editBeforeApprovalRate = approvalCount > 0 ? Math.round((editSignals.length / approvalCount) * 100) : 0;
  const approvalRate = Math.round((approvalCount / Math.max(1, approvalCount + rejectionCount)) * 100);
  const deleteRate = Math.round((deleteCount / Math.max(1, deleteCount + filteredSignals.filter((signal) => POST_SIGNAL_TYPES.has(signal.signalType)).length)) * 100);
  const editBurden = round(average(approvalSignals.map((signal) => readNumber(signal.metadata?.changedFeatureCount) || 0)), 1);
  const approvalTimes = approvalSignals
    .map((signal) => readNumber(signal.metadata?.timeToApprovalMins))
    .filter((value): value is number => value !== null);
  const medianTimeToApproval = approvalTimes.length > 0 ? Math.round(median(approvalTimes)) : 0;

  const performanceWindow = performanceHistory.filter((entry) =>
    inWindow(entry.postedAt, startMs, endMs) && (entry.source === 'autopilot' || Boolean(entry.tweetId))
  );
  const lift = computeLift(performanceWindow, baseline) ?? 0;
  const queueQuality = computeQueueQualityScore(liveWindowTweets, settings, approvalRate);
  const keptLiveRate = postCount > 0 ? Math.round(((postCount - deleteFromXSignals.length) / postCount) * 100) : 0;
  const learningVelocity = filteredSignals.length;
  const outcomeWindow = outcomeEpisodes.filter((episode) => inWindow(episode.observedAt, startMs, endMs));
  const calibration = computeCalibrationScore(outcomeWindow, tweetById);
  const baselineScore = baseline ? Math.max(1, baseline.avgLikes + (baseline.avgRetweets * 2)) : null;
  const outperformedBaseline = baselineScore === null
    ? 0
    : performanceWindow.filter((entry) => weightedEngagement(entry) > baselineScore).length;

  return {
    label,
    approvalRate,
    editBeforeApprovalRate,
    editBurden,
    deleteRate,
    engagementLift: lift,
    queueQuality,
    learningVelocity,
    keptLiveRate,
    medianTimeToApproval,
    calibration,
    approvals: approvalCount,
    rejections: rejectionCount,
    edits: editSignals.length,
    generated: generatedTweets.length,
    posted: postCount,
    keptLive: Math.max(0, postCount - deleteFromXSignals.length),
    outperformedBaseline,
    deleteFromX: deleteFromXSignals.length,
  };
}

function buildWeeklySeries(
  signals: LearningSignal[],
  allTweets: Tweet[],
  performanceHistory: TweetPerformance[],
  settings: ProtocolSettings,
  baseline: { avgLikes: number; avgRetweets: number } | null | undefined,
  outcomeEpisodes: OutcomeEpisode[],
  tweetById: Map<string, Tweet>,
): WindowMetrics[] {
  const nowMs = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const windows = [
    { label: '3w ago', startMs: nowMs - (weekMs * 4), endMs: nowMs - (weekMs * 3) },
    { label: '2w ago', startMs: nowMs - (weekMs * 3), endMs: nowMs - (weekMs * 2) },
    { label: 'Last week', startMs: nowMs - (weekMs * 2), endMs: nowMs - weekMs },
    { label: 'This week', startMs: nowMs - weekMs, endMs: undefined },
  ];

  return windows.map((window) => buildWindowMetrics({
    label: window.label,
    startMs: window.startMs,
    endMs: window.endMs,
    signals,
    allTweets,
    performanceHistory,
    settings,
    baseline,
    outcomeEpisodes,
    tweetById,
  }));
}

function buildSeriesPointSeries(metrics: WindowMetrics[]): LearningWeekPoint[] {
  return metrics.map((metric) => ({
    label: metric.label,
    approvalRate: metric.approvalRate,
    editBeforeApprovalRate: metric.editBeforeApprovalRate,
    editBurden: metric.editBurden,
    deleteRate: metric.deleteRate,
    deleteFromX: metric.deleteFromX,
    engagementLift: metric.engagementLift,
    queueQuality: metric.queueQuality,
    learningVelocity: metric.learningVelocity,
    keptLiveRate: metric.keptLiveRate,
    medianTimeToApproval: metric.medianTimeToApproval,
    calibration: metric.calibration,
  }));
}

function toneFromDelta(delta: number, higherIsBetter = true): LearningItemTone {
  if (delta === 0) return 'neutral';
  if (higherIsBetter) return delta > 0 ? 'positive' : 'warning';
  return delta < 0 ? 'positive' : 'danger';
}

function describeScoreboardMetric(
  id: LearningScoreboardCard['id'],
  current: WindowMetrics,
  previous: WindowMetrics,
): Pick<LearningScoreboardCard, 'interpretation' | 'tone'> {
  switch (id) {
    case 'approval_rate': {
      const delta = current.approvalRate - previous.approvalRate;
      return {
        interpretation: delta > 0
          ? 'More drafts are clearing the operator review loop.'
          : delta < 0
            ? 'More drafts are stalling or getting rejected before they move forward.'
            : 'Approval quality is holding steady week over week.',
        tone: toneFromDelta(delta, true),
      };
    }
    case 'edit_before_approval_rate': {
      const delta = current.editBeforeApprovalRate - previous.editBeforeApprovalRate;
      return {
        interpretation: delta < 0
          ? 'Fewer approved drafts need reshaping before they can move.'
          : delta > 0
            ? 'Operator rewrite burden is rising before approval.'
            : 'The edit burden before approval is steady.',
        tone: toneFromDelta(delta, false),
      };
    }
    case 'delete_rate': {
      const delta = current.deleteRate - previous.deleteRate;
      return {
        interpretation: delta < 0
          ? 'Fewer queued or live drafts are turning into misses.'
          : delta > 0
            ? 'More drafts are making it through only to get rejected or removed later.'
            : 'Delete pressure is flat week over week.',
        tone: toneFromDelta(delta, false),
      };
    }
    case 'engagement_lift': {
      const delta = current.engagementLift - previous.engagementLift;
      return {
        interpretation: delta > 0
          ? 'Live posts are beating the account baseline more consistently.'
          : delta < 0
            ? 'Recent live posts are drifting back toward or below baseline.'
            : 'Engagement lift is flat against baseline.',
        tone: toneFromDelta(delta, true),
      };
    }
    case 'queue_quality': {
      const delta = current.queueQuality - previous.queueQuality;
      return {
        interpretation: delta > 0
          ? 'The queue is healthier, cleaner, and easier to trust.'
          : delta < 0
            ? 'The queue is getting noisier or less ready to post.'
            : 'Queue health is stable.',
        tone: toneFromDelta(delta, true),
      };
    }
    case 'learning_velocity':
    default: {
      const delta = current.learningVelocity - previous.learningVelocity;
      return {
        interpretation: delta > 0
          ? 'The system is collecting more meaningful learning reps this week.'
          : delta < 0
            ? 'The learning loop is getting fewer fresh signals this week.'
            : 'Learning signal volume is steady.',
        tone: toneFromDelta(delta, true),
      };
    }
  }
}

function normalizeLiftScore(lift: number): number {
  return Math.round(clamp((lift + 25) / 50) * 100);
}

function summarizeTrajectory(current: WindowMetrics, previous: WindowMetrics): LearningScoreboard {
  const currentComposite = Math.round(
    (current.approvalRate * 0.35) +
    ((100 - current.deleteRate) * 0.25) +
    (normalizeLiftScore(current.engagementLift) * 0.2) +
    (current.queueQuality * 0.2)
  );
  const previousComposite = Math.round(
    (previous.approvalRate * 0.35) +
    ((100 - previous.deleteRate) * 0.25) +
    (normalizeLiftScore(previous.engagementLift) * 0.2) +
    (previous.queueQuality * 0.2)
  );
  const delta = currentComposite - previousComposite;

  if (delta >= 5) {
    return {
      state: 'improving',
      headline: 'The system is improving',
      explanation: 'Approval quality, live performance, and queue health are compounding in the right direction.',
      cards: [],
    };
  }

  if (delta <= -5) {
    return {
      state: 'regressing',
      headline: 'The system is regressing',
      explanation: 'Recent approval quality and draft quality signals are getting weaker and need intervention.',
      cards: [],
    };
  }

  return {
    state: 'stable',
    headline: 'The system is flat',
    explanation: 'The model is learning, but week-over-week quality movement is not yet clearly positive or negative.',
    cards: [],
  };
}

function buildScoreboard(metrics: WindowMetrics[]): LearningScoreboard {
  const current = metrics[metrics.length - 1];
  const previous = metrics[metrics.length - 2] || current;
  const base = summarizeTrajectory(current, previous);
  const cards: LearningScoreboardCard[] = [
    {
      id: 'approval_rate',
      label: 'Approval rate',
      currentValue: current.approvalRate,
      previousValue: previous.approvalRate,
      delta: current.approvalRate - previous.approvalRate,
      unit: 'percent',
      series: metrics.map((metric) => metric.approvalRate),
      ...describeScoreboardMetric('approval_rate', current, previous),
    },
    {
      id: 'edit_before_approval_rate',
      label: 'Edit-before-approval',
      currentValue: current.editBeforeApprovalRate,
      previousValue: previous.editBeforeApprovalRate,
      delta: current.editBeforeApprovalRate - previous.editBeforeApprovalRate,
      unit: 'percent',
      series: metrics.map((metric) => metric.editBeforeApprovalRate),
      ...describeScoreboardMetric('edit_before_approval_rate', current, previous),
    },
    {
      id: 'delete_rate',
      label: 'Delete rate',
      currentValue: current.deleteRate,
      previousValue: previous.deleteRate,
      delta: current.deleteRate - previous.deleteRate,
      unit: 'percent',
      series: metrics.map((metric) => metric.deleteRate),
      ...describeScoreboardMetric('delete_rate', current, previous),
    },
    {
      id: 'engagement_lift',
      label: 'Engagement lift',
      currentValue: current.engagementLift,
      previousValue: previous.engagementLift,
      delta: current.engagementLift - previous.engagementLift,
      unit: 'percent',
      series: metrics.map((metric) => metric.engagementLift),
      ...describeScoreboardMetric('engagement_lift', current, previous),
    },
    {
      id: 'queue_quality',
      label: 'Queue quality',
      currentValue: current.queueQuality,
      previousValue: previous.queueQuality,
      delta: current.queueQuality - previous.queueQuality,
      unit: 'score',
      series: metrics.map((metric) => metric.queueQuality),
      ...describeScoreboardMetric('queue_quality', current, previous),
    },
    {
      id: 'learning_velocity',
      label: 'Learning velocity',
      currentValue: current.learningVelocity,
      previousValue: previous.learningVelocity,
      delta: current.learningVelocity - previous.learningVelocity,
      unit: 'count',
      series: metrics.map((metric) => metric.learningVelocity),
      ...describeScoreboardMetric('learning_velocity', current, previous),
    },
  ];

  return {
    ...base,
    cards,
  };
}

function buildMetricSummary(
  current: number,
  previous: number,
  series: number[],
  positiveCopy: string,
  negativeCopy: string,
  neutralCopy: string,
  higherIsBetter = true,
): LearningMetricSummary {
  const delta = current - previous;
  let interpretation = neutralCopy;
  if ((higherIsBetter && delta > 0) || (!higherIsBetter && delta < 0)) {
    interpretation = positiveCopy;
  } else if (delta !== 0) {
    interpretation = negativeCopy;
  }

  return {
    currentWeek: current,
    previousWeek: previous,
    delta,
    interpretation,
    series,
  };
}

function buildCalibrationSummary(current: number, previous: number, series: number[]): LearningCalibrationSummary {
  const delta = current - previous;
  return {
    currentWeek: current,
    previousWeek: previous,
    delta,
    interpretation: delta > 0
      ? 'Predicted confidence is aligning better with real outcomes.'
      : delta < 0
        ? 'Predicted confidence is drifting away from real outcomes.'
        : 'Confidence calibration is steady.',
    series,
  };
}

function makeNarrativeItem(
  id: string,
  title: string,
  summary: string,
  evidence: string[],
  impact: number,
  tone: LearningItemTone,
  state: LearningStatusState,
): LearningNarrativeItem {
  return {
    id,
    title,
    summary,
    evidence,
    impact: round(impact, 1),
    tone,
    state,
  };
}

function buildNarratives(
  weeklySeries: WindowMetrics[],
  policy: BanditPolicy | null,
  memory: PersonalizationMemory,
): {
  topImprovements: LearningNarrativeItem[];
  topRegressions: LearningNarrativeItem[];
  policyChanges: LearningNarrativeItem[];
} {
  const current = weeklySeries[weeklySeries.length - 1];
  const previous = weeklySeries[weeklySeries.length - 2] || current;
  const improvements: LearningNarrativeItem[] = [];
  const regressions: LearningNarrativeItem[] = [];

  const approvalDelta = current.approvalRate - previous.approvalRate;
  if (approvalDelta !== 0) {
    const item = makeNarrativeItem(
      'approval-rate',
      'Approval quality',
      approvalDelta > 0
        ? 'Approval rate rose because more drafts cleared review without turning into misses.'
        : 'Approval rate slipped because more drafts stalled or were rejected before they stuck.',
      [
        `This week ${current.approvalRate}% approval vs ${previous.approvalRate}% last week.`,
        `${current.approvals} approval signals and ${current.rejections} rejection signals this week.`,
      ],
      Math.abs(approvalDelta),
      approvalDelta > 0 ? 'positive' : 'danger',
      approvalDelta > 0 ? 'improving' : 'regressing',
    );
    (approvalDelta > 0 ? improvements : regressions).push(item);
  }

  const deleteDelta = current.deleteRate - previous.deleteRate;
  if (deleteDelta !== 0) {
    const item = makeNarrativeItem(
      'delete-rate',
      'Delete pressure',
      deleteDelta < 0
        ? 'Delete rate improved because fewer queued or live drafts turned into misses.'
        : 'Delete rate worsened, so more weak drafts are still sneaking through.',
      [
        `This week ${current.deleteRate}% delete rate vs ${previous.deleteRate}% last week.`,
        `${current.deleteFromX} live deletions detected this week.`,
      ],
      Math.abs(deleteDelta),
      deleteDelta < 0 ? 'positive' : 'danger',
      deleteDelta < 0 ? 'improving' : 'regressing',
    );
    (deleteDelta < 0 ? improvements : regressions).push(item);
  }

  const engagementDelta = current.engagementLift - previous.engagementLift;
  if (engagementDelta !== 0) {
    const item = makeNarrativeItem(
      'engagement-lift',
      'Live performance',
      engagementDelta > 0
        ? 'Engagement lift improved because recent posts are beating the account baseline more often.'
        : 'Engagement lift fell, so recent live posts are closer to baseline or below it.',
      [
        `This week ${current.engagementLift >= 0 ? '+' : ''}${current.engagementLift}% lift vs ${previous.engagementLift >= 0 ? '+' : ''}${previous.engagementLift}% last week.`,
        `${current.outperformedBaseline} recent posts outperformed baseline this week.`,
      ],
      Math.abs(engagementDelta),
      engagementDelta > 0 ? 'positive' : 'warning',
      engagementDelta > 0 ? 'improving' : 'regressing',
    );
    (engagementDelta > 0 ? improvements : regressions).push(item);
  }

  const queueDelta = current.queueQuality - previous.queueQuality;
  if (queueDelta !== 0) {
    const item = makeNarrativeItem(
      'queue-quality',
      'Queue quality',
      queueDelta > 0
        ? 'Queue quality improved because recent drafts are healthier, safer, and closer to ready-to-post.'
        : 'Queue quality slipped, which usually means the current draft mix is getting noisier or less trustworthy.',
      [
        `Queue quality score ${current.queueQuality} this week vs ${previous.queueQuality} last week.`,
        `Current edit-before-approval rate is ${current.editBeforeApprovalRate}% and kept-live rate is ${current.keptLiveRate}%.`,
      ],
      Math.abs(queueDelta),
      queueDelta > 0 ? 'positive' : 'warning',
      queueDelta > 0 ? 'improving' : 'regressing',
    );
    (queueDelta > 0 ? improvements : regressions).push(item);
  }

  const policyChanges: LearningNarrativeItem[] = [];
  const lanes = buildExperimentLanes(policy);
  const topLane = lanes.find((lane) => lane.exploit && lane.exploit.localShare >= 0.5);
  if (topLane?.exploit) {
    policyChanges.push(makeNarrativeItem(
      `policy-${topLane.id}-winner`,
      `${topLane.title} winner is getting more weight`,
      `The chooser is leaning harder into ${sentenceCaseArm(topLane.exploit.arm)} because it is the strongest current ${topLane.title.toLowerCase()} bet.`,
      [
        `${Math.round(topLane.exploit.meanReward * 100)}% mean reward on ${Math.round(topLane.exploit.pulls)} pulls.`,
        topLane.provenance,
      ],
      Math.max(1, topLane.exploit.meanReward * 100),
      'positive',
      'improving',
    ));
  }
  const cautionLane = lanes.find((lane) => lane.caution);
  if (cautionLane?.caution) {
    policyChanges.push(makeNarrativeItem(
      `policy-${cautionLane.id}-caution`,
      `${cautionLane.title} caution tightened`,
      `The system is keeping ${sentenceCaseArm(cautionLane.caution.arm)} on a shorter leash until its miss profile improves.`,
      [
        `${Math.round(cautionLane.caution.failures)} recorded misses on ${Math.round(cautionLane.caution.pulls)} pulls.`,
        cautionLane.nextCheck,
      ],
      Math.max(1, cautionLane.caution.failures),
      'warning',
      'under_test',
    ));
  }
  const exploreLane = lanes.find((lane) => lane.explore);
  if (exploreLane?.explore) {
    policyChanges.push(makeNarrativeItem(
      `policy-${exploreLane.id}-explore`,
      `${exploreLane.title} challenger is still under test`,
      `The system is still spending reps on ${sentenceCaseArm(exploreLane.explore.arm)} before deciding whether it should scale.`,
      [
        `${Math.round(exploreLane.explore.explorationBonus * 100)} exploration bonus.`,
        exploreLane.nextCheck,
      ],
      Math.max(1, exploreLane.explore.explorationBonus * 100),
      'neutral',
      'under_test',
    ));
  }
  if (memory.neverDoThisAgain[0]) {
    policyChanges.push(makeNarrativeItem(
      'policy-avoid',
      'Negative lessons are hardening',
      `The system is adding stronger ranking pressure against "${memory.neverDoThisAgain[0]}".`,
      [
        'Avoid-list items now reduce exposure during generation and ranking.',
        'This is based on direct rejections or repeated negative outcomes.',
      ],
      8,
      'danger',
      'low_confidence',
    ));
  }

  return {
    topImprovements: improvements.sort((a, b) => b.impact - a.impact).slice(0, 3),
    topRegressions: regressions.sort((a, b) => b.impact - a.impact).slice(0, 3),
    policyChanges: policyChanges.slice(0, 3),
  };
}

function buildPolicyChangeEvents(
  items: LearningNarrativeItem[],
  createdAt: string,
): LearningEventEntry[] {
  return items.map((item) => ({
    id: `policy:${item.id}`,
    createdAt,
    title: item.title,
    summary: item.summary,
    learned: item.evidence[0] || 'Policy weighting changed.',
    source: item.tone === 'positive' ? 'bandit' : 'operator',
    tone: item.tone,
    rewardDelta: item.impact / 100,
    surface: 'autopilot',
    group: 'policy',
  }));
}

function buildDecisionInsights(
  allTweets: Tweet[],
  memory: PersonalizationMemory,
  lanes: LearningExperimentLane[],
  outcomeEpisodes: OutcomeEpisode[],
): Record<string, LearningDecisionInsight> {
  const episodeByTweetId = new Map(outcomeEpisodes.map((episode) => [String(episode.tweetId), episode]));

  return Object.fromEntries(allTweets.map((tweet) => {
    const predictedValue = getPredictedOutcomeValue(tweet);
    const outcomeEpisode = episodeByTweetId.get(String(tweet.id));
    const actualValue = outcomeEpisode ? clamp((outcomeEpisode.reward.total + 1) / 2) : null;
    const learningDelta = predictedValue !== null && actualValue !== null
      ? round(actualValue - predictedValue, 2)
      : null;

    let state: LearningStatusState = 'waiting';
    if (actualValue !== null && learningDelta !== null) {
      if (learningDelta >= 0.08) state = 'improving';
      else if (learningDelta <= -0.08) state = 'regressing';
      else state = 'stable';
    } else if ((tweet.confidenceScore ?? 0) < 0.52) {
      state = 'low_confidence';
    }

    const influencingLessons: string[] = [];
    if (tweet.topic && memory.topicsWithMomentum.some((topic) => topic.toLowerCase() === tweet.topic?.toLowerCase())) {
      influencingLessons.push(`Momentum on ${tweet.topic} is increasing exposure for this draft.`);
    }
    if (tweet.format && memory.formatsUnderTested.some((item) => item.toLowerCase().includes(tweet.format.toLowerCase()))) {
      influencingLessons.push(`${tweet.format.replace(/_/g, ' ')} is still under test, so this draft carries deliberate experiment weight.`);
    }
    if (memory.alwaysDoMoreOfThis[0]) {
      influencingLessons.push(`Positive lesson in rotation: ${memory.alwaysDoMoreOfThis[0]}`);
    }
    if (memory.neverDoThisAgain.some((item) => tweet.topic && item.toLowerCase().includes(tweet.topic.toLowerCase()))) {
      influencingLessons.push(`This topic brushes against the avoid list, so it is being watched more closely.`);
    }

    const influencingHypotheses = lanes.flatMap((lane) => {
      const matches = [
        lane.exploit?.arm,
        lane.explore?.arm,
        lane.caution?.arm,
        ...lane.underTest.map((arm) => arm.arm),
      ].filter(Boolean).map((value) => String(value).toLowerCase());
      const candidates = [
        tweet.format,
        tweet.topic,
        tweet.hookType,
        tweet.toneType,
        tweet.specificityType,
        tweet.structureType,
      ].filter(Boolean).map((value) => String(value).toLowerCase());

      return candidates.some((value) => matches.includes(value)) ? [lane.hypothesis] : [];
    }).slice(0, 2);

    const predictedLabel = predictedValue === null
      ? 'No prediction yet'
      : predictedValue >= 0.72
        ? 'Expected to outperform baseline'
        : predictedValue >= 0.58
          ? 'Expected to clear the normal approval threshold'
          : predictedValue >= 0.44
            ? 'Exploration bet with bounded upside'
            : 'Low-confidence candidate';

    const actualLabel = actualValue === null
      ? null
      : actualValue >= 0.7
        ? 'Actually beat the expected outcome'
        : actualValue >= 0.5
          ? 'Landed roughly where expected'
          : 'Underperformed and created negative evidence';

    const learned = outcomeEpisode
      ? (outcomeEpisode.reward.notes[0] || 'This live result now feeds the next ranking pass.')
      : 'Waiting for approval and live performance signals before the system updates its belief.';

    const evidence = [
      predictedValue !== null ? `Predicted outcome ${Math.round(predictedValue * 100)}%` : null,
      typeof tweet.confidenceScore === 'number' ? `Confidence ${Math.round(tweet.confidenceScore * 100)}%` : null,
      typeof tweet.rewardPrediction === 'number' ? `Predicted reward ${Math.round(tweet.rewardPrediction * 100)}%` : null,
      actualValue !== null ? `Actual settled outcome ${Math.round(actualValue * 100)}%` : null,
    ].filter((item): item is string => Boolean(item));

    return [String(tweet.id), {
      tweetId: String(tweet.id),
      state,
      predictedLabel,
      predictedScore: predictedValue !== null ? Math.round(predictedValue * 100) : null,
      actualLabel,
      actualScore: actualValue !== null ? Math.round(actualValue * 100) : null,
      learningDelta: learningDelta !== null ? Math.round(learningDelta * 100) : null,
      learned,
      influencingLessons: influencingLessons.slice(0, 3),
      influencingHypotheses,
      evidence,
    } satisfies LearningDecisionInsight];
  }));
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
  sourcePlan?: SourcePlannerPlan | null;
  manualExampleCuration?: ManualExampleCuration | null;
  trending?: EnrichedTrendingTopic[];
}

function buildPlannerPreview(
  settings: ProtocolSettings,
  learnings: AgentLearnings | null,
  sourcePlan: SourcePlannerPlan | null | undefined,
  manualExampleCuration: ManualExampleCuration | null | undefined,
  trending: EnrichedTrendingTopic[] | undefined,
): LearningPlannerPreview {
  const sourcePerf = new Map((learnings?.sourceLanePerformance || []).map((item) => [item.lane, item]));
  const laneOrder: ContentSourceLane[] = [
    'manual_core_exploit',
    'trend_aligned_exploit',
    'trend_adjacent_explore',
    'core_explore_fallback',
  ];

  const nextBatchMix = laneOrder.map((lane) => {
    const perf = sourcePerf.get(lane);
    return {
      lane,
      plannedSlots: sourcePlan?.laneCounts[lane] || 0,
      posts: perf?.posts || 0,
      avgEngagement: perf?.avgEngagement || 0,
      wins: perf?.wins || 0,
    };
  });

  const pinnedIds = new Set((manualExampleCuration?.pinnedXTweetIds || []).map((id) => String(id)));
  const blockedIds = new Set((manualExampleCuration?.blockedXTweetIds || []).map((id) => String(id)));
  const examples = [
    ...(learnings?.operatorVoiceReference?.bestPerformers || []),
    ...(learnings?.operatorVoiceReference?.pinnedExamples || []),
  ]
    .reduce<LearningManualExampleItem[]>((items, tweet) => {
      if (items.some((item) => item.xTweetId === String(tweet.xTweetId))) return items;
      items.push({
        xTweetId: String(tweet.xTweetId),
        content: tweet.content.slice(0, 180),
        likes: tweet.likes,
        pinned: pinnedIds.has(String(tweet.xTweetId)),
        blocked: blockedIds.has(String(tweet.xTweetId)),
      });
      return items;
    }, [])
    .slice(0, 8);

  const acceptedTrends = (sourcePlan?.acceptedTrends || trending?.filter((item) => item.sourceLane !== 'reject') || [])
    .slice(0, 6)
    .map((trend) => ({
      id: String(trend.id),
      category: trend.category,
      headline: trend.headline,
      lane: trend.sourceLane,
      fit: Math.round((trend.fitScores?.total || 0) * 100),
      reason: trend.plannerReason,
    }));

  const rejectedTrends = (sourcePlan?.rejectedTrends || trending?.filter((item) => item.sourceLane === 'reject') || [])
    .slice(0, 6)
    .map((trend) => ({
      id: String(trend.id),
      category: trend.category,
      headline: trend.headline,
      lane: trend.sourceLane,
      fit: Math.round((trend.fitScores?.total || 0) * 100),
      reason: trend.plannerReason,
    }));

  return {
    trendMixTarget: settings.trendMixTarget ?? 35,
    trendTolerance: settings.trendTolerance || 'moderate',
    nextBatchMix,
    acceptedTrends,
    rejectedTrends,
    manualExamples: {
      pinnedCount: pinnedIds.size,
      blockedCount: blockedIds.size,
      topicClusters: (learnings?.manualTopicProfile || []).slice(0, 6).map((cluster) => ({
        topic: cluster.topic,
        angle: cluster.angle,
        sampleCount: cluster.sampleCount,
        avgEngagement: cluster.avgEngagement,
      })),
      examples,
    },
  };
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
  sourcePlan,
  manualExampleCuration,
  trending,
}: BuildLearningSnapshotOptions): LearningSnapshot {
  const nowMs = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const liveTweets = allTweets.filter((tweet) => LIVE_TWEET_STATUSES.has(tweet.status));
  const averageConfidencePercent = averageConfidence(liveTweets);
  const outcomeEpisodes = buildOutcomeEpisodes({
    agentId: allTweets[0]?.agentId || 'agent',
    tweets: allTweets,
    signals,
    performanceHistory,
    baseline,
  });
  const weeklyMetrics = buildWeeklySeries(
    signals,
    allTweets,
    performanceHistory,
    settings,
    baseline,
    outcomeEpisodes,
    tweetById,
  );
  const weeklySeries = buildSeriesPointSeries(weeklyMetrics);
  const currentWeek = weeklyMetrics[weeklyMetrics.length - 1];
  const previousWeek = weeklyMetrics[weeklyMetrics.length - 2] || currentWeek;
  const scoreboard = buildScoreboard(weeklyMetrics);
  const narratives = buildNarratives(weeklyMetrics, banditPolicy, memory);
  const experimentLanes = buildExperimentLanes(banditPolicy);
  const decisionInsights = buildDecisionInsights(allTweets, memory, experimentLanes, outcomeEpisodes);
  const planner = buildPlannerPreview(settings, learnings, sourcePlan, manualExampleCuration, trending);
  const policyChangeEvents = buildPolicyChangeEvents(
    narratives.policyChanges,
    learnings?.updatedAt || memory.updatedAt || new Date().toISOString(),
  );

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
      engagementLiftPercent: computeLift(
        performanceHistory.filter((entry) => new Date(entry.postedAt).getTime() >= nowMs - (14 * 24 * 60 * 60 * 1000)),
        baseline,
      ),
      averageConfidencePercent,
      autonomyMode: settings.autonomyMode,
      explorationRate: settings.explorationRate,
      activeMix: activeMix(allTweets),
      trainingSource: banditPolicy?.trainingSource || null,
      trainingPulls: banditPolicy?.totalPulls || 0,
      localEvidenceWeight: banditPolicy?.localEvidenceWeight || 0,
      globalPriorWeight: banditPolicy?.globalPriorWeight || 0,
      recentSignals: recentWindowSignals(signals, nowMs - sevenDays).length,
    },
    scoreboard,
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
    weeklySeries,
    beliefState: buildBeliefState(memory, feedback),
    experiments: {
      summary: banditPolicy?.summary || [],
      lanes: experimentLanes,
    },
    recentEvents: [...buildRecentEvents(signals, allTweets), ...buildOutcomeEventEntries(outcomeEpisodes, allTweets), ...policyChangeEvents]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20),
    memory,
    learningVelocity: buildMetricSummary(
      currentWeek.learningVelocity,
      previousWeek.learningVelocity,
      weeklyMetrics.map((metric) => metric.learningVelocity),
      'The system is collecting more fresh learning signals this week.',
      'The system is collecting fewer fresh learning signals this week.',
      'Learning signal volume is steady.',
      true,
    ),
    queueQuality: buildMetricSummary(
      currentWeek.queueQuality,
      previousWeek.queueQuality,
      weeklyMetrics.map((metric) => metric.queueQuality),
      'The queue is healthier and easier to trust this week.',
      'The queue is getting weaker or noisier this week.',
      'Queue quality is steady.',
      true,
    ),
    calibration: buildCalibrationSummary(
      currentWeek.calibration,
      previousWeek.calibration,
      weeklyMetrics.map((metric) => metric.calibration),
    ),
    funnel: {
      generated: weeklyMetrics.reduce((sum, metric) => sum + metric.generated, 0),
      approved: weeklyMetrics.reduce((sum, metric) => sum + metric.approvals, 0),
      posted: weeklyMetrics.reduce((sum, metric) => sum + metric.posted, 0),
      keptLive: weeklyMetrics.reduce((sum, metric) => sum + metric.keptLive, 0),
      outperformedBaseline: weeklyMetrics.reduce((sum, metric) => sum + metric.outperformedBaseline, 0),
    },
    topImprovements: narratives.topImprovements,
    topRegressions: narratives.topRegressions,
    policyChanges: narratives.policyChanges,
    decisionInsights,
    planner,
  };
}
