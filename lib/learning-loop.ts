import type {
  AgentLearnings,
  FallbackShapeOutcomeCounter,
  FeedbackEntry,
  LearningSignal,
  Mention,
  PersonalizationMemory,
  Tweet,
  TweetPerformance,
  VoiceDirectiveRule,
} from './types';
import type { RemixEntry } from './kv-storage';
import type { BanditPolicy } from './bandit';
import type { VoiceProfile } from './soul-parser';
import { summarizeEditDelta, type EditDeltaSummary } from './outcome-rewards';
import {
  summarizeAudienceSegmentLessons,
  summarizeConversationInsights,
  summarizePromptStrategyLessons,
  summarizeReferenceBank,
} from './virality-signals';
import {
  mineReplyInsights,
  summarizeMediaExperimentLessons,
  summarizeNetworkClusterLessons,
  summarizePortfolioLessons,
  summarizeRelationshipLessons,
  summarizeReplyMiningInsights,
  summarizeViralityPostmortemMemory,
} from './growth-engine';
import { classifyTasteFeedbackReason } from './account-taste';

export { summarizeEditDelta };
export type { EditDeltaSummary };

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function weightedScore(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return entry.likes + entry.retweets + (entry.replies * 2);
}

function sortCounts(entries: Record<string, number>): string[] {
  return Object.entries(entries)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

function readPreferenceHints(metadata: LearningSignal['metadata']): string[] {
  const hints: string[] = [];
  const singleHint = typeof metadata?.preferenceHint === 'string' ? metadata.preferenceHint.trim() : '';
  if (singleHint) hints.push(singleHint);

  const packedHints = typeof metadata?.preferenceHints === 'string' ? metadata.preferenceHints : '';
  for (const hint of packedHints.split(/\n+/)) {
    const trimmed = hint.trim();
    if (trimmed) hints.push(trimmed);
  }

  return unique(hints);
}

function isFallbackRationale(value: string | null | undefined): boolean {
  const rationale = String(value || '').toLowerCase();
  return rationale.includes('template fallback')
    || rationale.includes('emergency fallback')
    || rationale.includes('emergency deterministic');
}

export function buildFallbackLearningMetadata(
  tweet: Pick<Tweet, 'rationale' | 'sourceLane' | 'scoreProvenance' | 'draftExperimentId' | 'featureTags' | 'thesis' | 'topic'>,
): Record<string, string | number | boolean | null> {
  const draftExperimentId = String(tweet.draftExperimentId || '');
  const fallbackKind = isFallbackRationale(tweet.rationale)
    ? String(tweet.rationale || '').toLowerCase().includes('emergency')
      ? 'emergency_queue_fallback'
      : 'provider_template_fallback'
    : tweet.sourceLane === 'core_explore_fallback' || draftExperimentId.includes('-fallback-')
      ? 'provider_template_fallback'
      : null;

  if (!fallbackKind) return {};

  const memoryAlignment = readScore(tweet.scoreProvenance?.memoryAlignment);
  const authorityProof = readScore(tweet.scoreProvenance?.authorityProof);
  const conversationQuality = readScore(tweet.scoreProvenance?.conversationQuality);
  const operatorAnchor = readScore(tweet.scoreProvenance?.operatorAnchor);
  const anchorCopyRisk = readScoreMagnitude(tweet.scoreProvenance?.anchorCopyRisk);

  return {
    generationFallback: true,
    fallbackKind,
    fallbackMemoryAligned: Boolean(memoryAlignment && memoryAlignment > 0),
    fallbackMemoryAlignment: memoryAlignment,
    fallbackOperatorAnchor: Boolean(operatorAnchor && operatorAnchor > 0),
    fallbackOperatorAnchorScore: operatorAnchor,
    fallbackAnchorCopyRisk: anchorCopyRisk,
    fallbackAuthorityProof: authorityProof,
    fallbackConversationQuality: conversationQuality,
    fallbackSourceLane: tweet.sourceLane || null,
    fallbackTopic: tweet.topic || null,
    fallbackHook: tweet.featureTags?.hook || null,
    fallbackTone: tweet.featureTags?.tone || null,
    fallbackSpecificity: tweet.featureTags?.specificity || null,
    fallbackStructure: tweet.featureTags?.structure || null,
    fallbackThesis: tweet.featureTags?.thesis || tweet.thesis || null,
  };
}

function buildMomentumTopics(
  performanceHistory: TweetPerformance[],
  baselineLikes: number,
): string[] {
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const topicStats = new Map<string, { total: number; count: number }>();

  for (const entry of performanceHistory) {
    if (!entry.topic || entry.topic === 'unknown' || entry.topic === 'general') continue;
    if (new Date(entry.postedAt).getTime() < recentCutoff) continue;
    const current = topicStats.get(entry.topic) || { total: 0, count: 0 };
    current.total += weightedScore(entry);
    current.count += 1;
    topicStats.set(entry.topic, current);
  }

  return [...topicStats.entries()]
    .map(([topic, stats]) => ({
      topic,
      avg: stats.total / Math.max(stats.count, 1),
      count: stats.count,
    }))
    .filter((entry) => entry.count >= 2 && entry.avg >= Math.max(1, baselineLikes))
    .sort((a, b) => b.avg - a.avg || b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 4)
    .map((entry) => entry.topic);
}

function summarizeOperatorPreferences(signals: LearningSignal[], remixPatterns: RemixEntry[]): string[] {
  const counts: Record<string, number> = {};

  for (const remix of remixPatterns) {
    counts[`Remix preference: ${remix.direction}`] = (counts[`Remix preference: ${remix.direction}`] || 0) + 1;
  }

  for (const signal of signals) {
    for (const hint of readPreferenceHints(signal.metadata)) {
      counts[hint] = (counts[hint] || 0) + 1;
    }
    const lengthDirection = typeof signal.metadata?.lengthDirection === 'string' ? signal.metadata.lengthDirection : null;
    if (lengthDirection === 'shorter') counts['Operators often tighten drafts before approving them.'] = (counts['Operators often tighten drafts before approving them.'] || 0) + 1;
    if (lengthDirection === 'longer') counts['Operators sometimes want deeper, more developed arguments.'] = (counts['Operators sometimes want deeper, more developed arguments.'] || 0) + 1;
    if (signal.metadata?.addedQuestionHook === true) counts['Question-led hooks keep showing up in operator edits.'] = (counts['Question-led hooks keep showing up in operator edits.'] || 0) + 1;
    if (signal.metadata?.addedSpecificity === true) counts['Specificity and numbers are often added before approval.'] = (counts['Specificity and numbers are often added before approval.'] || 0) + 1;
  }

  return sortCounts(counts).slice(0, 4);
}

function summarizeNativeTasteComplaints(signals: LearningSignal[], feedback: FeedbackEntry[]): string[] {
  const counts: Record<string, number> = {};

  for (const entry of feedback) {
    const classified = classifyTasteFeedbackReason(entry.intentSummary || entry.reason, entry.tweetText);
    for (const hint of classified.preferenceHints) {
      counts[hint] = (counts[hint] || 0) + 1;
    }
  }

  for (const signal of signals) {
    const reason = signal.reason || '';
    const classified = classifyTasteFeedbackReason(reason);
    for (const hint of classified.preferenceHints) {
      counts[hint] = (counts[hint] || 0) + 1;
    }
    for (const hint of readPreferenceHints(signal.metadata)) {
      if (/native Geoffrey|technical depth|Slack\/support|generated-post cadence|interchangeable/i.test(hint)) {
        counts[hint] = (counts[hint] || 0) + 1;
      }
    }
  }

  return sortCounts(counts).slice(0, 5);
}

function summarizeFallbackOutcomePreferences(signals: LearningSignal[]): string[] {
  const counts: Record<string, number> = {};

  for (const signal of signals) {
    if (signal.metadata?.generationFallback !== true) continue;
    const memoryAligned = signal.metadata.fallbackMemoryAligned === true;
    const operatorAnchored = signal.metadata.fallbackOperatorAnchor === true;
    const kind = typeof signal.metadata.fallbackKind === 'string'
      ? signal.metadata.fallbackKind.replace(/_/g, ' ')
      : 'fallback draft';
    const kindLabel = operatorAnchored ? `operator-anchor ${kind}` : kind;
    const thesis = typeof signal.metadata.fallbackThesis === 'string' ? signal.metadata.fallbackThesis.trim() : '';
    const thesisLabel = thesis ? ` Thesis: ${thesis.slice(0, 90)}.` : '';
    const topic = typeof signal.metadata.fallbackTopic === 'string' ? signal.metadata.fallbackTopic.trim() : '';
    const topicLabel = topic ? ` Topic: ${topic.slice(0, 48)}.` : '';
    const hook = typeof signal.metadata.fallbackHook === 'string' ? signal.metadata.fallbackHook.trim() : '';
    const structure = typeof signal.metadata.fallbackStructure === 'string' ? signal.metadata.fallbackStructure.trim() : '';
    const specificity = typeof signal.metadata.fallbackSpecificity === 'string' ? signal.metadata.fallbackSpecificity.trim() : '';
    const shape = [hook, structure, specificity].filter(Boolean).join('/');
    const shapeLabel = shape ? ` Shape: ${shape}.` : '';
    const copyRisk = typeof signal.metadata.fallbackAnchorCopyRisk === 'number' ? signal.metadata.fallbackAnchorCopyRisk : 0;
    const copyRiskLabel = operatorAnchored && copyRisk > 0.05
      ? ` Anchor copy risk was ${Math.round(copyRisk * 100)}%, so keep varying the literal wording.`
      : '';

    if (signal.signalType === 'approved_without_edit' || signal.signalType === 'x_post_succeeded') {
      const line = operatorAnchored
        ? `Fallback lesson: ${kindLabel} drafts can survive approval/posting; keep borrowing the human-written hook, tone, and structure without copying anchor text.${copyRiskLabel}${shapeLabel}${topicLabel}${thesisLabel}`
        : memoryAligned
        ? `Fallback lesson: memory-aligned ${kind} drafts can survive approval/posting; keep using learned specificity and structure when providers degrade.${shapeLabel}${topicLabel}${thesisLabel}`
        : `Fallback lesson: ${kind} drafts survived approval/posting; preserve the fallback shape but keep watching for generic phrasing.${shapeLabel}${topicLabel}${thesisLabel}`;
      counts[line] = (counts[line] || 0) + 1;
    }

    if (signal.signalType === 'edited_before_queue' || signal.signalType === 'edited_before_post') {
      const line = operatorAnchored
        ? `Fallback lesson: ${kindLabel} drafts still needed operator edits; keep the anchor-derived shape but relearn the claim, proof, or cadence from the rewrite.${copyRiskLabel}${shapeLabel}${topicLabel}${thesisLabel}`
        : `Fallback lesson: ${kind} drafts still needed operator edits; treat fallback prose as a starting point, not a voice match.${shapeLabel}${topicLabel}${thesisLabel}`;
      counts[line] = (counts[line] || 0) + 1;
    }

    if (signal.signalType === 'deleted_from_queue' || signal.signalType === 'deleted_from_x' || signal.signalType === 'x_post_rejected') {
      const line = operatorAnchored
        ? `Fallback lesson: ${kindLabel} drafts were rejected; do not trust anchor shape alone unless the next draft adds fresher proof, a narrower claim, and safer wording.${copyRiskLabel}${shapeLabel}${topicLabel}${thesisLabel}`
        : `Fallback lesson: ${kind} drafts were rejected; cool down this deterministic fallback shape unless it has fresher proof or a narrower claim.${shapeLabel}${topicLabel}${thesisLabel}`;
      counts[line] = (counts[line] || 0) + 1;
    }
  }

  return sortCounts(counts).slice(0, 3);
}

function summarizeFallbackShapeOutcomes(signals: LearningSignal[]): FallbackShapeOutcomeCounter[] {
  type WeightedFallbackShapeOutcomeCounter = FallbackShapeOutcomeCounter & {
    weightedRaw: number;
    weightedTotal: number;
  };

  const fallbackSignals = signals.filter((signal) =>
    signal.metadata?.generationFallback === true && signal.metadata.fallbackOperatorAnchor === true
  );
  const referenceTime = Math.max(
    0,
    ...fallbackSignals.map((signal) => new Date(signal.createdAt).getTime()).filter(Number.isFinite),
  );
  const counters = new Map<string, WeightedFallbackShapeOutcomeCounter>();

  for (const signal of fallbackSignals) {
    const fallbackKind = typeof signal.metadata.fallbackKind === 'string' ? signal.metadata.fallbackKind.trim() : '';
    const topic = typeof signal.metadata.fallbackTopic === 'string' ? signal.metadata.fallbackTopic.trim() : '';
    const hook = typeof signal.metadata.fallbackHook === 'string' ? signal.metadata.fallbackHook.trim() : '';
    const structure = typeof signal.metadata.fallbackStructure === 'string' ? signal.metadata.fallbackStructure.trim() : '';
    const specificity = typeof signal.metadata.fallbackSpecificity === 'string' ? signal.metadata.fallbackSpecificity.trim() : '';
    if (!fallbackKind || !hook || !structure || !specificity) continue;

    const shape = [hook, structure, specificity].join('/');
    const key = `${fallbackKind}:${topic.toLowerCase()}:${shape}`;
    const current = counters.get(key) || {
      fallbackKind,
      topic: topic || undefined,
      shape,
      hook,
      structure,
      specificity,
      approved: 0,
      posted: 0,
      edited: 0,
      rejected: 0,
      total: 0,
      netScore: 0,
      updatedAt: signal.createdAt,
      weightedRaw: 0,
      weightedTotal: 0,
    };

    let rawSignalScore = 0;
    let latestOutcome: FallbackShapeOutcomeCounter['latestOutcome'] | null = null;
    if (signal.signalType === 'approved_without_edit') {
      current.approved += 1;
      rawSignalScore = 0.7;
      latestOutcome = 'approved';
    }
    if (signal.signalType === 'x_post_succeeded') {
      current.posted += 1;
      rawSignalScore = 1;
      latestOutcome = 'posted';
    }
    if (signal.signalType === 'edited_before_queue' || signal.signalType === 'edited_before_post') {
      current.edited += 1;
      rawSignalScore = -0.45;
      latestOutcome = 'edited';
    }
    if (signal.signalType === 'deleted_from_queue' || signal.signalType === 'deleted_from_x' || signal.signalType === 'x_post_rejected') {
      current.rejected += 1;
      rawSignalScore = -1.2;
      latestOutcome = 'rejected';
    }

    current.total = current.approved + current.posted + current.edited + current.rejected;
    if (rawSignalScore !== 0 && referenceTime > 0) {
      const observedAt = new Date(signal.createdAt).getTime();
      const ageDays = Number.isFinite(observedAt) ? Math.max(0, (referenceTime - observedAt) / (24 * 60 * 60 * 1000)) : 0;
      const recencyWeight = ageDays <= 14
        ? 1
        : ageDays >= 90
          ? 0.35
          : 1 - ((ageDays - 14) / 76 * 0.65);
      current.weightedRaw += rawSignalScore * recencyWeight;
      current.weightedTotal += recencyWeight;
    }
    const signalTime = new Date(signal.createdAt).getTime();
    if (Number.isFinite(signalTime) && signalTime >= new Date(current.updatedAt).getTime()) {
      current.updatedAt = signal.createdAt;
      if (latestOutcome) {
        current.latestOutcome = latestOutcome;
        current.latestOutcomeAt = signal.createdAt;
      }
    }
    counters.set(key, current);
  }

  return [...counters.values()]
    .filter((counter) => counter.total > 0)
    .map((counter) => {
      const confidence = Math.min(1, counter.weightedTotal / 4);
      const netScore = Math.max(-1, Math.min(1, (counter.weightedRaw / Math.max(counter.weightedTotal, 1)) * confidence));
      const { weightedRaw: _weightedRaw, weightedTotal: _weightedTotal, ...publicCounter } = counter;
      return {
        ...publicCounter,
        netScore: Number(netScore.toFixed(3)),
      };
    })
    .sort((a, b) => Math.abs(b.netScore) - Math.abs(a.netScore) || b.total - a.total || a.shape.localeCompare(b.shape))
    .slice(0, 8);
}

function summarizeEditTransformations(signals: LearningSignal[]): string[] {
  const counts: Record<string, number> = {};

  for (const signal of signals) {
    if (signal.signalType !== 'edited_before_queue' && signal.signalType !== 'edited_before_post') continue;
    const originalHook = typeof signal.metadata?.originalHook === 'string' ? signal.metadata.originalHook : null;
    const editedHook = typeof signal.metadata?.editedHook === 'string' ? signal.metadata.editedHook : null;
    const originalTone = typeof signal.metadata?.originalTone === 'string' ? signal.metadata.originalTone : null;
    const editedTone = typeof signal.metadata?.editedTone === 'string' ? signal.metadata.editedTone : null;
    const originalSpecificity = typeof signal.metadata?.originalSpecificity === 'string' ? signal.metadata.originalSpecificity : null;
    const editedSpecificity = typeof signal.metadata?.editedSpecificity === 'string' ? signal.metadata.editedSpecificity : null;
    const originalStructure = typeof signal.metadata?.originalStructure === 'string' ? signal.metadata.originalStructure : null;
    const editedStructure = typeof signal.metadata?.editedStructure === 'string' ? signal.metadata.editedStructure : null;

    if (originalHook && editedHook && originalHook !== editedHook) {
      counts[`Edit pattern: hooks improve when ${originalHook.replace(/_/g, ' ')} becomes ${editedHook.replace(/_/g, ' ')}.`] = (counts[`Edit pattern: hooks improve when ${originalHook.replace(/_/g, ' ')} becomes ${editedHook.replace(/_/g, ' ')}.`] || 0) + 1;
    }
    if (originalTone && editedTone && originalTone !== editedTone) {
      counts[`Edit pattern: tone shifts from ${originalTone.replace(/_/g, ' ')} toward ${editedTone.replace(/_/g, ' ')} before approval.`] = (counts[`Edit pattern: tone shifts from ${originalTone.replace(/_/g, ' ')} toward ${editedTone.replace(/_/g, ' ')} before approval.`] || 0) + 1;
    }
    if (originalSpecificity && editedSpecificity && originalSpecificity !== editedSpecificity) {
      counts[`Edit pattern: specificity moves from ${originalSpecificity.replace(/_/g, ' ')} to ${editedSpecificity.replace(/_/g, ' ')}.`] = (counts[`Edit pattern: specificity moves from ${originalSpecificity.replace(/_/g, ' ')} to ${editedSpecificity.replace(/_/g, ' ')}.`] || 0) + 1;
    }
    if (originalStructure && editedStructure && originalStructure !== editedStructure) {
      counts[`Edit pattern: structure changes from ${originalStructure.replace(/_/g, ' ')} to ${editedStructure.replace(/_/g, ' ')}.`] = (counts[`Edit pattern: structure changes from ${originalStructure.replace(/_/g, ' ')} to ${editedStructure.replace(/_/g, ' ')}.`] || 0) + 1;
    }

    const originalDraft = typeof signal.metadata?.originalDraft === 'string' ? signal.metadata.originalDraft : null;
    const editedDraft = typeof signal.metadata?.editedDraft === 'string' ? signal.metadata.editedDraft : null;
    if (originalDraft && editedDraft) {
      const line = `Before/after edit: "${originalDraft.slice(0, 100)}" -> "${editedDraft.slice(0, 100)}"`;
      counts[line] = (counts[line] || 0) + 1;
    }
  }

  return sortCounts(counts).slice(0, 5);
}

function summarizeWeeklyChanges(
  signals: LearningSignal[],
  feedback: FeedbackEntry[],
  momentumTopics: string[],
): string[] {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentSignals = signals.filter((signal) => new Date(signal.createdAt).getTime() >= sevenDaysAgo);
  const recentFeedback = feedback.filter((entry) => new Date(entry.generatedAt).getTime() >= sevenDaysAgo);
  const changes: string[] = [];

  const approvals = recentSignals.filter((signal) => signal.signalType === 'approved_without_edit').length;
  const edits = recentSignals.filter((signal) => signal.signalType === 'edited_before_queue' || signal.signalType === 'edited_before_post').length;
  const deletes = recentSignals.filter((signal) => signal.signalType === 'deleted_from_queue' || signal.signalType === 'deleted_from_x').length;
  const tasteSignals = recentSignals.filter((signal) =>
    signal.signalType === 'taste_more_like_this'
    || signal.signalType === 'taste_less_like_this'
    || signal.signalType === 'taste_calibration_edit'
  ).length;

  if (approvals > 0) changes.push(`${approvals} drafts were approved cleanly this week — the baseline voice fit is improving.`);
  if (edits > 0) changes.push(`${edits} drafts needed operator reshaping this week, so those edits are feeding hidden preference memory.`);
  if (deletes > 0) changes.push(`${deletes} rejected tweets sharpened the blocklist this week.`);
  if (tasteSignals > 0) changes.push(`${tasteSignals} taste calibration signal${tasteSignals === 1 ? '' : 's'} tightened the owner preference model this week.`);
  if (momentumTopics.length > 0) changes.push(`Momentum is building around ${momentumTopics.slice(0, 2).join(' and ')} right now.`);

  const recentReasons = unique(recentFeedback.map((entry) => entry.intentSummary || entry.reason)).slice(0, 2);
  for (const reason of recentReasons) {
    changes.push(`Recent feedback is pushing the system away from: ${reason}.`);
  }

  return changes.slice(0, 4);
}

function readScore(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
}

function readScoreMagnitude(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value > 1 ? value / 100 : value);
  return Math.max(0, Math.min(1, normalized));
}

function readTweetPromise(tweet: Tweet): number | null {
  return readScore(tweet.predictedEngagementScore)
    ?? readScore(tweet.rewardPrediction)
    ?? readScore(tweet.confidenceScore)
    ?? readScore(tweet.judgeScore)
    ?? readScore(tweet.candidateScore);
}

function tweetOutcomeSeverity(tweet: Tweet): number {
  const reward = tweet.rewardBreakdown;
  if (!reward) return 0;

  const total = typeof reward.total === 'number' && Number.isFinite(reward.total) ? reward.total : 0;
  const delayed = typeof reward.delayedTotal === 'number' && Number.isFinite(reward.delayedTotal) ? reward.delayedTotal : 0;
  const engagementLift = typeof reward.engagementLift === 'number' && Number.isFinite(reward.engagementLift) ? reward.engagementLift : 0;
  const actionTotal = typeof reward.actionRewards?.total === 'number' && Number.isFinite(reward.actionRewards.total)
    ? reward.actionRewards.total
    : 0;

  return Math.max(
    total < -0.1 ? Math.abs(total) : 0,
    delayed < -0.16 ? Math.abs(delayed) : 0,
    engagementLift < -0.2 ? Math.abs(engagementLift) : 0,
    actionTotal < -0.2 ? Math.abs(actionTotal) : 0,
  );
}

function summarizeOutcomeFatigueLessons(tweets: Tweet[]): string[] {
  const groups = new Map<string, {
    topic: string;
    format: string;
    hook: string;
    specificity: string;
    structure: string;
    count: number;
    totalPromise: number;
    totalReward: number;
    totalSeverity: number;
    newestAt: number;
    thesis: string | null;
  }>();

  for (const tweet of tweets) {
    if (!tweet.rewardBreakdown) continue;
    if (tweet.status !== 'posted' && tweet.status !== 'deleted_from_x') continue;

    const promise = readTweetPromise(tweet);
    if (promise === null || promise < 0.62) continue;

    const severity = tweetOutcomeSeverity(tweet);
    if (severity < 0.16) continue;

    const topic = (tweet.topic || 'general').trim();
    const format = (tweet.format || 'unknown').trim();
    const hook = (tweet.featureTags?.hook || tweet.hookType || 'unknown').replace(/_/g, ' ');
    const specificity = (tweet.featureTags?.specificity || tweet.specificityType || 'unknown').replace(/_/g, ' ');
    const structure = (tweet.featureTags?.structure || tweet.structureType || 'unknown').replace(/_/g, ' ');
    const key = [topic, format, hook, specificity, structure].map((value) => value.toLowerCase()).join('|');
    const rewardTotal = typeof tweet.rewardBreakdown.total === 'number' && Number.isFinite(tweet.rewardBreakdown.total)
      ? tweet.rewardBreakdown.total
      : 0;
    const timestamp = tweet.rewardBreakdown.computedAt || tweet.postedAt || tweet.createdAt;
    const observedAt = new Date(timestamp).getTime();

    const current = groups.get(key) || {
      topic,
      format,
      hook,
      specificity,
      structure,
      count: 0,
      totalPromise: 0,
      totalReward: 0,
      totalSeverity: 0,
      newestAt: 0,
      thesis: null,
    };

    current.count += 1;
    current.totalPromise += promise;
    current.totalReward += rewardTotal;
    current.totalSeverity += severity;
    if (Number.isFinite(observedAt) && observedAt > current.newestAt) {
      current.newestAt = observedAt;
      current.thesis = tweet.thesis || tweet.featureTags?.thesis || null;
    }
    groups.set(key, current);
  }

  return [...groups.values()]
    .sort((a, b) => {
      const severityDiff = (b.totalSeverity / b.count) - (a.totalSeverity / a.count);
      if (severityDiff !== 0) return severityDiff;
      return b.newestAt - a.newestAt;
    })
    .slice(0, 5)
    .map((group) => {
      const avgPromise = Math.round((group.totalPromise / group.count) * 100);
      const avgReward = group.totalReward / group.count;
      const countLabel = `${group.count} post${group.count === 1 ? '' : 's'}`;
      const thesis = group.thesis ? ` Recent thesis: ${group.thesis.slice(0, 90)}.` : '';
      return `Outcome fatigue: ${group.format} on ${group.topic} with ${group.hook} hook / ${group.specificity} specificity / ${group.structure} structure underperformed after strong predicted fit (${countLabel}, avg promise ${avgPromise}%, avg reward ${avgReward >= 0 ? '+' : ''}${avgReward.toFixed(2)}). Cool down this shape or rebuild it with fresher proof, a narrower claim, and a different structure.${thesis}`;
    });
}

function summarizeDirectiveRules(rules: VoiceDirectiveRule[]): string[] {
  return unique(rules.map((rule) => {
    const scopeLabel = rule.scope.type === 'general'
      ? 'Voice rule'
      : `${rule.scope.type.replace(/_/g, ' ')} rule`;
    return `${scopeLabel}: ${rule.systemLesson} (${rule.normalizedRule})`;
  })).slice(0, 4);
}

export interface BuildPersonalizationMemoryOptions {
  feedback: FeedbackEntry[];
  signals: LearningSignal[];
  remixPatterns: RemixEntry[];
  directiveRules: VoiceDirectiveRule[];
  learnings: AgentLearnings | null;
  performanceHistory: TweetPerformance[];
  banditPolicy: BanditPolicy | null;
  voiceProfile: VoiceProfile;
  allTweets?: Tweet[];
  baselineLikes?: number;
  mentions?: Mention[];
}

export function buildPersonalizationMemory({
  feedback,
  signals,
  remixPatterns,
  directiveRules,
  learnings,
  performanceHistory,
  banditPolicy,
  voiceProfile,
  allTweets = [],
  baselineLikes = 0,
  mentions = [],
}: BuildPersonalizationMemoryOptions): PersonalizationMemory {
  const alwaysDoMoreOfThis = unique([
    ...(learnings?.insights.slice(0, 3) || []),
    ...(learnings?.bestPerformers.slice(0, 2).map((entry) => `Reuse the energy of: ${entry.content.slice(0, 80)}...`) || []),
  ]).slice(0, 5);

  const neverDoThisAgain = unique([
    ...feedback.map((entry) => entry.intentSummary || entry.reason || '').filter(Boolean),
    ...(learnings?.styleFingerprint?.antiPatterns || []),
  ]).slice(0, 5);
  const rejectedDrafts = unique(
    feedback
      .filter((entry) => entry.rating === 'down' && entry.tweetText.trim())
      .map((entry) => entry.tweetText.trim())
      .reverse(),
  ).slice(0, 20);

  const topicsWithMomentum = buildMomentumTopics(performanceHistory, baselineLikes);
  const formatsUnderTested = (banditPolicy?.formatArms || [])
    .filter((arm) => arm.coldStart || arm.pulls < 3)
    .slice(0, 4)
    .map((arm) => `${arm.arm} needs more data`);

  const operatorHiddenPreferences = unique([
    ...summarizeFallbackOutcomePreferences(signals),
    ...summarizeOperatorPreferences(signals, remixPatterns),
    ...summarizeNativeTasteComplaints(signals, feedback),
  ]).slice(0, 5);
  const fallbackShapeOutcomes = summarizeFallbackShapeOutcomes(signals);
  const editTransformations = summarizeEditTransformations(signals);
  const referenceBank = summarizeReferenceBank(performanceHistory);
  const conversationInsights = summarizeConversationInsights(performanceHistory);
  const audienceSegmentLessons = summarizeAudienceSegmentLessons(performanceHistory);
  const promptStrategyLessons = summarizePromptStrategyLessons(performanceHistory);
  const replyMiningInsights = summarizeReplyMiningInsights(mineReplyInsights(mentions));
  const networkClusterLessons = summarizeNetworkClusterLessons(learnings);
  const mediaExperimentLessons = summarizeMediaExperimentLessons(learnings);
  const portfolioLessons = summarizePortfolioLessons(learnings);
  const relationshipLessons = summarizeRelationshipLessons(learnings);
  const viralityPostmortems = summarizeViralityPostmortemMemory(learnings);
  const outcomeFatigueLessons = summarizeOutcomeFatigueLessons(allTweets);

  const identityConstraints = unique([
    ...summarizeDirectiveRules(directiveRules),
    ...voiceProfile.antiGoals.map((goal) => `Never: ${goal}`),
  ]).slice(0, 5);

  const weeklyChanges = summarizeWeeklyChanges(signals, feedback, topicsWithMomentum);

  return {
    alwaysDoMoreOfThis,
    neverDoThisAgain,
    rejectedDrafts,
    topicsWithMomentum,
    formatsUnderTested,
    operatorHiddenPreferences,
    fallbackShapeOutcomes,
    editTransformations,
    referenceBank,
    conversationInsights,
    audienceSegmentLessons,
    promptStrategyLessons,
    networkClusterLessons,
    mediaExperimentLessons,
    portfolioLessons,
    relationshipLessons,
    viralityPostmortems,
    replyMiningInsights,
    outcomeFatigueLessons,
    identityConstraints,
    weeklyChanges,
    updatedAt: new Date().toISOString(),
  };
}
