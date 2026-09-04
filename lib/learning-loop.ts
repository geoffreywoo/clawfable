import type {
  AgentLearnings,
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
import { summarizeBanditExploitLessons } from './bandit';
import type { VoiceProfile } from './soul-parser';
import { buildOutcomeEpisodes, summarizeEditDelta, type EditDeltaSummary } from './outcome-rewards';
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
import { isMaturePerformance, summarizeFollowerGrowth, weightedSpreadEngagement } from './performance-signals';
import { filterLearningEvidence } from './learning-evidence';

export { summarizeEditDelta };
export type { EditDeltaSummary };

export function buildEditLearningMetadata(original: string, edited: string, topic?: string): NonNullable<LearningSignal['metadata']> {
  const summary = summarizeEditDelta(original, edited);
  return {
    ...summary.metadata,
    originalDraft: original,
    editedDraft: edited,
    preferenceHint: summary.preferenceHints[0] || null,
    preferenceHints: summary.preferenceHints.join('\n') || null,
    acceptedEdit: true,
    editTopic: topic || null,
  };
}

export interface ApprovedEditExample {
  signalId: string;
  tweetId?: string;
  before: string;
  after: string;
  lesson: string;
  createdAt: string;
}

/** Recover missing examples in a derived view; never rewrite the raw signal ledger. */
export function recoverEditLearningSignals(signals: LearningSignal[], tweets: Tweet[]): LearningSignal[] {
  const byId = new Map(tweets.map((tweet) => [String(tweet.id), tweet]));
  const recovered = signals.map((signal) => {
    if (!['edited_before_queue', 'edited_before_post'].includes(signal.signalType) || signal.inferred) return signal;
    if (typeof signal.metadata?.originalDraft === 'string' && typeof signal.metadata?.editedDraft === 'string') return signal;
    const child = signal.tweetId ? byId.get(String(signal.tweetId)) : undefined;
    const parentId = signal.metadata?.parentTweetId || child?.parentTweetId;
    const parent = parentId ? byId.get(String(parentId)) : undefined;
    if (!child || !parent || parent.pipelineVersion !== 'v2' || (child.editCount || 0) > 0) return signal;
    if (typeof signal.metadata?.originalLength === 'number' && signal.metadata.originalLength !== parent.content.length) return signal;
    if (typeof signal.metadata?.editedLength === 'number' && signal.metadata.editedLength !== child.content.length) return signal;
    if (parent.content === child.content || parent.content.length > 4000 || child.content.length > 4000) return signal;
    return { ...signal, metadata: { ...signal.metadata,
      ...buildEditLearningMetadata(parent.content, child.content, child.topic || undefined),
      acceptedEdit: child.status === 'queued' || child.status === 'posted',
      parentTweetId: parent.id, editPairRecovered: true, editPairRecoverySource: 'immutable_parent_child',
    } };
  });
  const signaledChildren = new Set(signals.filter((signal) => ['edited_before_queue', 'edited_before_post'].includes(signal.signalType))
    .map((signal) => String(signal.tweetId)));
  for (const child of tweets) {
    if (!child.parentTweetId || child.contentProvenance !== 'operator_written' || signaledChildren.has(String(child.id))) continue;
    if ((child.editCount || 0) > 0 || (child.status !== 'queued' && child.status !== 'posted')) continue;
    const parent = byId.get(String(child.parentTweetId));
    if (!parent || parent.pipelineVersion !== 'v2' || parent.content === child.content
      || parent.content.length > 4000 || child.content.length > 4000) continue;
    const summary = summarizeEditDelta(parent.content, child.content);
    recovered.push({ id: `derived-edit:${parent.id}:${child.id}`, agentId: child.agentId, tweetId: child.id,
      signalType: child.status === 'queued' ? 'edited_before_queue' : 'edited_before_post', surface: 'queue',
      rewardDelta: summary.rewardDelta, createdAt: child.createdAt, reason: summary.summary,
      metadata: { ...buildEditLearningMetadata(parent.content, child.content, child.topic || undefined),
        parentTweetId: parent.id, editPairRecovered: true, editPairRecoverySource: 'immutable_parent_child' },
    });
  }
  return recovered;
}

export function selectApprovedEditExamples(signals: LearningSignal[], topic?: string, limit = 2): ApprovedEditExample[] {
  const editTypes = new Set(['edited_before_queue', 'edited_before_post', 'taste_calibration_edit']);
  const rejectionTypes = new Set(['deleted_from_queue', 'deleted_from_x', 'taste_less_like_this', 'reply_rejected']);
  const currentSignals = filterLearningEvidence(signals).signals;
  const topicWords = new Set(((topic || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .filter((word) => !['the', 'and', 'of', 'to', 'in', 'on', 'for'].includes(word)));
  const subjects = (signal: LearningSignal) => [signal.tweetId, signal.metadata?.parentTweetId].filter(Boolean).map(String);
  const pair = (signal: LearningSignal) => ({
    before: typeof signal.metadata?.originalDraft === 'string' ? signal.metadata.originalDraft.trim() : '',
    after: typeof signal.metadata?.editedDraft === 'string' ? signal.metadata.editedDraft.trim() : '',
  });
  const candidates = currentSignals.flatMap((signal) => {
    if (!editTypes.has(signal.signalType) || signal.inferred || signal.metadata?.acceptedEdit === false) return [];
    const { before, after } = pair(signal);
    // Preserve a whole correction within the existing queue/post input bound.
    // A partially copied after-state teaches the wrong writing decision.
    if (!before || !after || before === after || before.length > 4000 || after.length > 4000) return [];
    const created = Date.parse(signal.createdAt);
    if (!Number.isFinite(created)) return [];
    const related = new Set(subjects(signal));
    const superseded = currentSignals.some((event) => {
      if (Date.parse(event.createdAt) <= created || !subjects(event).some((subject) => related.has(subject))) return false;
      if (rejectionTypes.has(event.signalType) && event.metadata?.softArchive !== true) return true;
      if (!editTypes.has(event.signalType)) return false;
      const newer = pair(event);
      return Boolean(newer.after && newer.after !== after);
    });
    if (superseded) return [];
    const lesson = signal.reason || 'Match the owner’s revised judgment, detail, and rhythm.';
    const featureLesson = [lesson, signal.metadata?.preferenceHints, signal.metadata?.editedHook,
      signal.metadata?.editedTone, signal.metadata?.editedSpecificity, signal.metadata?.editedStructure].join(' ').toLowerCase();
    const relevance = [...topicWords].filter((word) => featureLesson.includes(word)).length;
    const sourceTopic = String(signal.metadata?.editTopic || '').toLowerCase();
    const crossTopic = sourceTopic && topicWords.size > 0 && ![...topicWords].some((word) => sourceTopic.includes(word));
    const ageDays = Math.max(0, (Date.now() - created) / 86400000);
    // Transferable lesson matches dominate recency. Prefer cross-topic examples
    // when relevance is close so calibration does not become premise copying.
    const score = relevance + (1 / (1 + ageDays / 14)) + (crossTopic ? 0.15 : 0);
    return [{ signalId: signal.id, tweetId: signal.tweetId, before, after, lesson, createdAt: signal.createdAt, score }];
  }).sort((a, b) => b.score - a.score || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const seen = new Set<string>();
  const selected: ApprovedEditExample[] = [];
  let remainingChars = 10000;
  for (const { score: _score, ...example } of candidates) {
    const key = JSON.stringify([example.before, example.after]);
    const chars = example.before.length + example.after.length;
    if (seen.has(key) || chars > remainingChars) continue;
    seen.add(key);
    selected.push(example);
    remainingChars -= chars;
    if (selected.length >= Math.max(0, limit)) break;
  }
  return limit <= 0 ? [] : selected;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function weightedScore(entry: TweetPerformance): number {
  return weightedSpreadEngagement(entry);
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

export function buildGenerationLearningMetadata(
  tweet: Pick<
    Tweet,
    | 'pipelineVersion'
    | 'generationRunId'
    | 'generationSurface'
    | 'generationTriggerId'
    | 'storyClusterId'
    | 'ideaId'
    | 'draftCandidateId'
    | 'evidenceReferences'
    | 'portfolioCompanyContext'
  >,
): Record<string, string | number | boolean | null> {
  return {
    pipelineVersion: tweet.pipelineVersion || null,
    generationRunId: tweet.generationRunId || null,
    generationSurface: tweet.generationSurface || null,
    generationTriggerId: tweet.generationTriggerId || null,
    storyClusterId: tweet.storyClusterId || null,
    ideaId: tweet.ideaId || null,
    draftCandidateId: tweet.draftCandidateId || null,
    evidenceCount: tweet.evidenceReferences?.length || 0,
    evidenceSourceIds: tweet.evidenceReferences?.map((reference) => reference.sourceDocumentId).join(',') || null,
    portfolioCompanyId: tweet.portfolioCompanyContext?.companyId || null,
    portfolioCompanyName: tweet.portfolioCompanyContext?.companyName || null,
    portfolioCompanyPolicyVersion: tweet.portfolioCompanyContext?.policyVersion || null,
    portfolioCompanySnapshotVersion: tweet.portfolioCompanyContext?.snapshotVersion || null,
  };
}

function buildMomentumTopics(
  performanceHistory: TweetPerformance[],
  baselineLikes: number,
): string[] {
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  // Momentum must be judged on the same spread-weighted scale as the topic
  // averages below. The stored baseline is likes-only, so prefer the
  // account's actual spread-weighted mean from history; fall back to an
  // uplifted likes baseline when history is thin.
  const spreadSamples = performanceHistory.slice(0, 60).map(weightedScore);
  const spreadBaseline = spreadSamples.length >= 5
    ? spreadSamples.reduce((sum, value) => sum + value, 0) / spreadSamples.length
    : Math.max(1, baselineLikes) * 1.35;
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
    .filter((entry) => entry.count >= 2 && entry.avg >= Math.max(1, spreadBaseline))
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
    if (signal.metadata?.acceptedEdit === false) continue;
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

function summarizeNativeTasteComplaints(
  signals: LearningSignal[],
  feedback: FeedbackEntry[],
  voiceProfile: VoiceProfile,
): string[] {
  const counts: Record<string, number> = {};

  // Classify the operator's stated reason only; the rejected tweet text is
  // never evidence of a preference, and account-specific wording is gated on
  // the voice profile.
  for (const entry of feedback) {
    if (entry.rating !== 'down') continue;
    const classified = classifyTasteFeedbackReason(entry.intentSummary || entry.reason, '', { voiceProfile });
    for (const hint of classified.preferenceHints) {
      counts[hint] = (counts[hint] || 0) + 1;
    }
  }

  for (const signal of signals) {
    const reason = signal.reason || '';
    const classified = classifyTasteFeedbackReason(reason, '', { voiceProfile });
    for (const hint of classified.preferenceHints) {
      counts[hint] = (counts[hint] || 0) + 1;
    }
    for (const hint of readPreferenceHints(signal.metadata)) {
      if (/native Geoffrey|native voice|native content identity|technical depth|Slack\/support|generated-post cadence|interchangeable/i.test(hint)) {
        counts[hint] = (counts[hint] || 0) + 1;
      }
    }
  }

  return sortCounts(counts).slice(0, 7);
}

function summarizeEditTransformations(signals: LearningSignal[]): string[] {
  const counts: Record<string, number> = {};

  for (const signal of signals) {
    if (!['edited_before_queue', 'edited_before_post', 'taste_calibration_edit'].includes(signal.signalType)
      || signal.metadata?.acceptedEdit === false || signal.inferred) continue;
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

  const recentReasons = unique(recentFeedback.filter((entry) => entry.rating === 'down').map((entry) => entry.intentSummary || entry.reason)).slice(0, 2);
  for (const reason of recentReasons) {
    changes.push(`Recent feedback is pushing the system away from: ${reason}.`);
  }

  return changes.slice(0, 4);
}

function readScore(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
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
  followerSnapshots?: Array<{ capturedAt: string; followersCount: number }>;
}

export function isDuplicateOnlyRejection(entry: FeedbackEntry): boolean {
  const reason = `${entry.intentSummary || ''} ${entry.reason || ''}`.toLowerCase();
  return /\bduplicate premise\b/.test(reason)
    && /\bkeep (?:the )?(?:sharper |stronger )?(?:original|draft)\b/.test(reason);
}

/**
 * Rejections stop shaping the verbatim exclusion corpus after 21 days. Every
 * prompt block that quotes rejected text must use this same window so the
 * idea space actually reopens when the window closes.
 */
export const REJECTED_DRAFT_EXPIRY_MS = 21 * 24 * 60 * 60 * 1000;

function isActiveRejection(entry: FeedbackEntry, cutoffMs: number): boolean {
  return entry.rating === 'down'
    && Boolean(entry.tweetText?.trim())
    && !isDuplicateOnlyRejection(entry)
    && Date.parse(entry.generatedAt) >= cutoffMs;
}

/**
 * The most recent operator rejections as quotable prompt lines, oldest to
 * newest, under the same 21-day / duplicate-only rules as
 * `PersonalizationMemory.rejectedDrafts`.
 */
export function selectRecentRejectionLines(feedback: FeedbackEntry[], limit: number, now = Date.now()): string[] {
  if (limit <= 0) return [];
  const cutoff = now - REJECTED_DRAFT_EXPIRY_MS;
  return feedback
    .filter((entry) => isActiveRejection(entry, cutoff))
    .slice(-limit)
    .map((entry) => {
      const reason = entry.intentSummary?.trim() || entry.reason?.trim();
      return reason ? `${entry.tweetText.trim()} (why it was rejected: ${reason})` : entry.tweetText.trim();
    });
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
  followerSnapshots = [],
}: BuildPersonalizationMemoryOptions): PersonalizationMemory {
  ({ signals, feedback } = filterLearningEvidence(signals, feedback, allTweets));
  signals = recoverEditLearningSignals(signals, allTweets);
  performanceHistory = performanceHistory.filter(isMaturePerformance);
  const alwaysDoMoreOfThis = unique([
    ...feedback.filter((entry) => entry.rating === 'up').map((entry) => entry.intentSummary || entry.reason || ''),
    ...(learnings?.insights.slice(0, 3) || []),
    ...summarizeReferenceBank(learnings?.bestPerformers || []).slice(0, 2),
  ]).slice(0, 5);

  const neverDoThisAgain = unique([
    ...feedback.filter((entry) => entry.rating === 'down').map((entry) => entry.intentSummary || entry.reason || '').filter(Boolean),
    ...(learnings?.styleFingerprint?.antiPatterns || []),
  ]).slice(0, 5);
  // Rejections expire after 21 days: the exclusion corpus previously only
  // grew, so every rejection permanently shrank the addressable idea space.
  // Old rejections keep influencing style via neverDoThisAgain lessons; only
  // the verbatim do-not-resemble corpus is time-bounded.
  const rejectionCutoff = Date.now() - REJECTED_DRAFT_EXPIRY_MS;
  const rejectedDrafts = unique(
    feedback
      .filter((entry) => isActiveRejection(entry, rejectionCutoff))
      .map((entry) => entry.tweetText.trim())
      .reverse(),
  ).slice(0, 20);

  const topicsWithMomentum = buildMomentumTopics(performanceHistory, baselineLikes);
  const formatsUnderTested = (banditPolicy?.formatArms || [])
    .filter((arm) => arm.coldStart || arm.pulls < 3)
    .slice(0, 4)
    .map((arm) => `${arm.arm} needs more data`);
  const whatIsWorkingNow = summarizeBanditExploitLessons(banditPolicy);
  const followerGrowth = summarizeFollowerGrowth(followerSnapshots);

  const operatorHiddenPreferences = unique([
    ...summarizeOperatorPreferences(signals, remixPatterns),
    ...summarizeNativeTasteComplaints(signals, feedback, voiceProfile),
  ]).slice(0, 7);
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
  const currentEpisodes = buildOutcomeEpisodes({ agentId: allTweets[0]?.agentId || 'agent', tweets: allTweets,
    signals, performanceHistory });
  const matureRewards = new Map(currentEpisodes.filter((episode) => episode.stage === 'final')
    .map((episode) => [String(episode.tweetId), episode.reward]));
  const outcomeFatigueLessons = summarizeOutcomeFatigueLessons(allTweets.map((tweet) => ({
    ...tweet, rewardBreakdown: matureRewards.get(String(tweet.id)),
  })));

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
    whatIsWorkingNow,
    followerGrowth,
    operatorHiddenPreferences,
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
