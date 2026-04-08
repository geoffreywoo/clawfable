import type {
  AgentLearnings,
  FeedbackEntry,
  LearningSignal,
  PersonalizationMemory,
  TweetPerformance,
  VoiceDirectiveRule,
} from './types';
import type { RemixEntry } from './kv-storage';
import type { BanditPolicy } from './bandit';
import type { VoiceProfile } from './soul-parser';

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

export interface EditDeltaSummary {
  summary: string;
  preferenceHints: string[];
  metadata: Record<string, string | number | boolean | null>;
  rewardDelta: number;
}

export function summarizeEditDelta(original: string, edited: string): EditDeltaSummary {
  const preferenceHints: string[] = [];
  const metadata: Record<string, string | number | boolean | null> = {
    originalLength: original.length,
    editedLength: edited.length,
  };

  if (edited.length < original.length * 0.85) {
    preferenceHints.push('Operator keeps tightening drafts before approval.');
    metadata.lengthDirection = 'shorter';
  } else if (edited.length > original.length * 1.15) {
    preferenceHints.push('Operator often wants more depth before a tweet feels ready.');
    metadata.lengthDirection = 'longer';
  }

  if (!original.includes('?') && edited.includes('?')) {
    preferenceHints.push('Question hooks are often added during edits.');
    metadata.addedQuestionHook = true;
  }

  if (!/\d/.test(original) && /\d/.test(edited)) {
    preferenceHints.push('Operators add numbers or specifics before approving.');
    metadata.addedSpecificity = true;
  }

  if (!original.includes('\n') && edited.includes('\n')) {
    preferenceHints.push('Structured line breaks improve operator confidence.');
    metadata.addedStructure = true;
  }

  const summary = preferenceHints[0] || 'Operator edited this draft before approving it.';
  const rewardDelta = preferenceHints.length === 0 ? 0.3 : 0.2;

  return {
    summary,
    preferenceHints,
    metadata,
    rewardDelta,
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
    const hint = typeof signal.metadata?.preferenceHint === 'string' ? signal.metadata.preferenceHint : null;
    if (hint) counts[hint] = (counts[hint] || 0) + 1;
    const lengthDirection = typeof signal.metadata?.lengthDirection === 'string' ? signal.metadata.lengthDirection : null;
    if (lengthDirection === 'shorter') counts['Operators often tighten drafts before approving them.'] = (counts['Operators often tighten drafts before approving them.'] || 0) + 1;
    if (lengthDirection === 'longer') counts['Operators sometimes want deeper, more developed arguments.'] = (counts['Operators sometimes want deeper, more developed arguments.'] || 0) + 1;
    if (signal.metadata?.addedQuestionHook === true) counts['Question-led hooks keep showing up in operator edits.'] = (counts['Question-led hooks keep showing up in operator edits.'] || 0) + 1;
    if (signal.metadata?.addedSpecificity === true) counts['Specificity and numbers are often added before approval.'] = (counts['Specificity and numbers are often added before approval.'] || 0) + 1;
  }

  return sortCounts(counts).slice(0, 4);
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

  if (approvals > 0) changes.push(`${approvals} drafts were approved cleanly this week — the baseline voice fit is improving.`);
  if (edits > 0) changes.push(`${edits} drafts needed operator reshaping this week, so those edits are feeding hidden preference memory.`);
  if (deletes > 0) changes.push(`${deletes} rejected tweets sharpened the blocklist this week.`);
  if (momentumTopics.length > 0) changes.push(`Momentum is building around ${momentumTopics.slice(0, 2).join(' and ')} right now.`);

  const recentReasons = unique(recentFeedback.map((entry) => entry.intentSummary || entry.reason)).slice(0, 2);
  for (const reason of recentReasons) {
    changes.push(`Recent feedback is pushing the system away from: ${reason}.`);
  }

  return changes.slice(0, 4);
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
  baselineLikes?: number;
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
  baselineLikes = 0,
}: BuildPersonalizationMemoryOptions): PersonalizationMemory {
  const alwaysDoMoreOfThis = unique([
    ...(learnings?.insights.slice(0, 3) || []),
    ...(learnings?.bestPerformers.slice(0, 2).map((entry) => `Reuse the energy of: ${entry.content.slice(0, 80)}...`) || []),
  ]).slice(0, 5);

  const neverDoThisAgain = unique([
    ...feedback.map((entry) => entry.intentSummary || entry.reason || '').filter(Boolean),
    ...(learnings?.styleFingerprint?.antiPatterns || []),
  ]).slice(0, 5);

  const topicsWithMomentum = buildMomentumTopics(performanceHistory, baselineLikes);
  const formatsUnderTested = (banditPolicy?.formatArms || [])
    .filter((arm) => arm.coldStart || arm.pulls < 3)
    .slice(0, 4)
    .map((arm) => `${arm.arm} needs more data`);

  const operatorHiddenPreferences = summarizeOperatorPreferences(signals, remixPatterns);

  const identityConstraints = unique([
    ...summarizeDirectiveRules(directiveRules),
    ...voiceProfile.antiGoals.map((goal) => `Never: ${goal}`),
  ]).slice(0, 5);

  const weeklyChanges = summarizeWeeklyChanges(signals, feedback, topicsWithMomentum);

  return {
    alwaysDoMoreOfThis,
    neverDoThisAgain,
    topicsWithMomentum,
    formatsUnderTested,
    operatorHiddenPreferences,
    identityConstraints,
    weeklyChanges,
    updatedAt: new Date().toISOString(),
  };
}
