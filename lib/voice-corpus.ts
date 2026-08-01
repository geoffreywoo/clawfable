import type {
  CandidateFeatureTags,
  LearningSignal,
  ManualExampleCuration,
  PostLogEntry,
  Tweet,
  TweetPerformance,
  VoiceCorpusAuthorshipProvenance,
  VoiceCorpusDisposition,
  VoiceCorpusEntry,
  VoiceCorpusSnapshot,
} from './types';
import { extractCandidateFeatureTags } from './tweet-features';
import { scoreSlopRisk } from './virality-signals';
import { assessGeneratedWritingPatterns } from './writing-patterns';

export const VOICE_CORPUS_SCHEMA_VERSION = 1;
export const VOICE_CORPUS_TARGET_ANCHORS = 40;
export const VOICE_CORPUS_MAX_ANCHORS = 50;
export const VOICE_CORPUS_MIN_ANCHORS = 12;

const NEGATIVE_SIGNAL_TYPES = new Set([
  'deleted_from_queue',
  'deleted_from_x',
  'taste_less_like_this',
  'x_post_rejected',
]);

const PROMO_PATTERN = /\b(?:sign up|waitlist|book a demo|available now|launching today|new episode|follow me|subscribe|use code)\b/i;
const QUOTATION_PATTERN = /^(?:["'\u201c\u2018].{20,}["'\u201d\u2019](?:\s*[-\u2014].*)?|(?:quote|from)[:\s])/i;
const TRAILING_FRAGMENT_PATTERN = /(?:,|&|\b(?:and|or|the|a|an|to|of|for|with))\s*$/i;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^a-z0-9']+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function nearDuplicate(left: string, right: string): boolean {
  const leftWords = new Set(normalizeWords(left));
  const rightWords = new Set(normalizeWords(right));
  if (leftWords.size === 0 || rightWords.size === 0) return false;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return shared / Math.max(1, union) >= 0.48;
}

function hasGenerationMarkers(tweet: Tweet | undefined): boolean {
  if (!tweet) return false;
  return Boolean(
    tweet.generationProvider
    || tweet.generationModel
    || tweet.sourceLane
    || tweet.candidateScore !== null && tweet.candidateScore !== undefined
    || tweet.judgeScore !== null && tweet.judgeScore !== undefined
    || tweet.generationMode,
  );
}

function classifyProvenance(
  performance: TweetPerformance,
  internalTweet: Tweet | undefined,
  generatedXIds: Set<string>,
  generatedContentHashes: Set<string>,
): { provenance: VoiceCorpusAuthorshipProvenance; confidence: number } {
  const xTweetId = String(performance.xTweetId);
  if (
    performance.source === 'autopilot'
    || generatedXIds.has(xTweetId)
    || generatedContentHashes.has(stableHash(performance.content.trim()))
    || hasGenerationMarkers(internalTweet)
  ) {
    return { provenance: 'known_clawfable_generated', confidence: 1 };
  }
  if (internalTweet && internalTweet.type === 'original') {
    return { provenance: 'operator_composed', confidence: 0.98 };
  }
  if (performance.source === 'timeline') {
    return { provenance: 'timeline_unmatched', confidence: 0.82 };
  }
  return { provenance: 'unknown', confidence: 0.35 };
}

function exclusionReasons(
  performance: TweetPerformance,
  provenance: VoiceCorpusAuthorshipProvenance,
  negative: boolean,
  blocked: boolean,
  slopScore: number,
  patternRisk: number,
): string[] {
  const content = performance.content.trim();
  const prose = content.replace(/https?:\/\/\S+/gi, ' ').replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = normalizeWords(prose).length;
  const reasons: string[] = [];

  if (provenance === 'known_clawfable_generated') reasons.push('known Clawfable-generated post');
  if (provenance === 'unknown') reasons.push('authorship provenance is uncertain');
  if (negative) reasons.push('explicit negative operator signal');
  if (blocked) reasons.push('explicitly blocked example');
  if (!content || content.length < 25 || wordCount < 6) reasons.push('insufficient standalone prose');
  if (/^@\w+/.test(content)) reasons.push('reply-shaped post');
  if (performance.referenceType) reasons.push(`${performance.referenceType} post`);
  if (PROMO_PATTERN.test(content)) reasons.push('promotional post');
  if (QUOTATION_PATTERN.test(content)) reasons.push('quotation rather than native prose');
  if (/https?:\/\/\S+/i.test(content) && wordCount < 16) reasons.push('media or link dependent caption');
  if (performance.hasMedia && wordCount < 18) reasons.push('media-dependent caption');
  if (performance.isTextComplete === false) reasons.push('incomplete X text payload');
  if ((content.length >= 220 && TRAILING_FRAGMENT_PATTERN.test(content)) || /(?:\.\.\.|\u2026)$/.test(content)) {
    reasons.push('possibly truncated or incomplete text');
  }
  if (performance.format === 'unknown' || ['general', 'unknown'].includes((performance.topic || '').toLowerCase())) {
    reasons.push('classification backlog is incomplete');
  }
  if (slopScore >= 0.32) reasons.push(`slop risk ${slopScore.toFixed(2)}`);
  if (patternRisk >= 0.28) reasons.push(`generated-pattern risk ${patternRisk.toFixed(2)}`);
  return [...new Set(reasons)];
}

function entrySignature(entry: VoiceCorpusEntry): string {
  const length = entry.content.length < 120 ? 'short' : entry.content.length < 320 ? 'medium' : 'long';
  return `${entry.featureTags.hook}:${entry.featureTags.structure}:${entry.featureTags.tone}:${length}`;
}

function selectDictionAnchors(entries: VoiceCorpusEntry[], pinnedIds: Set<string>): VoiceCorpusEntry[] {
  const eligible = entries
    .filter((entry) => entry.exclusionReasons.length === 0 && entry.dispositions.includes('topic_signal'))
    .sort((left, right) => (
      Number(pinnedIds.has(right.xTweetId)) - Number(pinnedIds.has(left.xTweetId))
      || right.selectionScore - left.selectionScore
      || right.postedAt.localeCompare(left.postedAt)
    ));
  const selected: VoiceCorpusEntry[] = [];
  const topicCounts = new Map<string, number>();
  const signatureCounts = new Map<string, number>();

  for (const entry of eligible) {
    const pinned = pinnedIds.has(entry.xTweetId);
    const topic = entry.topic.toLowerCase();
    const signature = entrySignature(entry);
    if (!pinned && (topicCounts.get(topic) || 0) >= 8) {
      entry.selectionReasons.push('not selected: topic diversity cap reached');
      continue;
    }
    if (!pinned && (signatureCounts.get(signature) || 0) >= 4) {
      entry.selectionReasons.push('not selected: cadence and structure diversity cap reached');
      continue;
    }
    if (!pinned && selected.some((candidate) => nearDuplicate(candidate.content, entry.content))) {
      entry.selectionReasons.push('not selected: near-duplicate of a stronger anchor');
      continue;
    }

    selected.push(entry);
    entry.selectionReasons.push('selected as an eligible diction anchor');
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
    if (selected.length >= VOICE_CORPUS_MAX_ANCHORS) break;
    if (selected.length >= VOICE_CORPUS_TARGET_ANCHORS && !pinned) break;
  }
  return selected;
}

export function buildVoiceCorpusSnapshot({
  agentId,
  history,
  tweets,
  postLog,
  signals,
  curation,
  generatedAt = new Date().toISOString(),
}: {
  agentId: string;
  history: TweetPerformance[];
  tweets: Tweet[];
  postLog: PostLogEntry[];
  signals: LearningSignal[];
  curation: ManualExampleCuration;
  generatedAt?: string;
}): VoiceCorpusSnapshot {
  const tweetsByXId = new Map(
    tweets.filter((tweet) => tweet.xTweetId).map((tweet) => [String(tweet.xTweetId), tweet]),
  );
  const tweetsById = new Map(tweets.map((tweet) => [String(tweet.id), tweet]));
  const generatedXIds = new Set<string>([
    ...tweets.filter(hasGenerationMarkers).map((tweet) => String(tweet.xTweetId || '')).filter(Boolean),
    ...postLog
      .filter((entry) => entry.action === 'posted' && ['autopilot', 'cron'].includes(entry.source))
      .map((entry) => String(entry.xTweetId || ''))
      .filter(Boolean),
  ]);
  const generatedContentHashes = new Set<string>([
    ...tweets
      .filter(hasGenerationMarkers)
      .map((tweet) => stableHash(tweet.content.trim())),
    ...postLog
      .filter((entry) => entry.action === 'posted' && ['autopilot', 'cron'].includes(entry.source))
      .map((entry) => stableHash(entry.content.trim())),
  ]);
  const negativeTweetIds = new Set(
    signals.filter((signal) => NEGATIVE_SIGNAL_TYPES.has(signal.signalType)).map((signal) => String(signal.tweetId || '')).filter(Boolean),
  );
  const negativeXIds = new Set(
    signals.filter((signal) => NEGATIVE_SIGNAL_TYPES.has(signal.signalType)).map((signal) => String(signal.xTweetId || '')).filter(Boolean),
  );
  for (const tweetId of negativeTweetIds) {
    const xTweetId = tweetsById.get(tweetId)?.xTweetId;
    if (xTweetId) negativeXIds.add(String(xTweetId));
  }
  const blockedIds = new Set(curation.blockedXTweetIds.map(String));
  const pinnedIds = new Set(curation.pinnedXTweetIds.map(String));

  const entries = history.map((performance): VoiceCorpusEntry => {
    const xTweetId = String(performance.xTweetId);
    const internalTweet = tweetsByXId.get(xTweetId);
    const { provenance, confidence } = classifyProvenance(
      performance,
      internalTweet,
      generatedXIds,
      generatedContentHashes,
    );
    const featureTags: CandidateFeatureTags = extractCandidateFeatureTags(performance.content, {
      topic: performance.topic,
      thesisHint: performance.thesis,
    });
    const slopScore = scoreSlopRisk(performance.content, featureTags);
    const generatedPatternRisk = assessGeneratedWritingPatterns(performance.content).score;
    const negative = negativeXIds.has(xTweetId);
    const blocked = blockedIds.has(xTweetId);
    const exclusions = exclusionReasons(
      performance,
      provenance,
      negative,
      blocked,
      slopScore,
      generatedPatternRisk,
    );
    const engagement = performance.likes + (performance.retweets * 2) + performance.replies;
    const engagementScore = clamp(Math.log1p(engagement) / Math.log(500));
    const nativeScore = clamp(
      confidence * 0.42
      + (1 - slopScore) * 0.28
      + (1 - generatedPatternRisk) * 0.3,
    );
    const selectionScore = clamp(
      nativeScore * 0.72
      + engagementScore * 0.18
      + (pinnedIds.has(xTweetId) ? 0.1 : 0),
    );
    const dispositions: VoiceCorpusDisposition[] = [];
    if (provenance === 'known_clawfable_generated') dispositions.push('mechanics_only');
    else if (exclusions.length === 0) dispositions.push('topic_signal');
    if (negative || blocked) dispositions.push('negative');
    if (exclusions.length > 0 && !dispositions.includes('mechanics_only')) dispositions.push('excluded');

    return {
      xTweetId,
      tweetId: internalTweet?.id || performance.tweetId || null,
      content: performance.content,
      contentHash: stableHash(performance.content),
      provenance,
      authorshipConfidence: Number(confidence.toFixed(3)),
      dispositions: [...new Set<VoiceCorpusDisposition>(dispositions)],
      nativeScore: Number(nativeScore.toFixed(3)),
      slopScore: Number(slopScore.toFixed(3)),
      generatedPatternRisk: Number(generatedPatternRisk.toFixed(3)),
      selectionScore: Number(selectionScore.toFixed(3)),
      selectionReasons: [
        `authorship ${provenance} (${confidence.toFixed(2)})`,
        `native quality ${nativeScore.toFixed(2)}`,
        pinnedIds.has(xTweetId) ? 'explicitly pinned' : 'automatic corpus candidate',
      ],
      exclusionReasons: exclusions,
      topic: performance.topic || 'general',
      featureTags,
      likes: performance.likes,
      retweets: performance.retweets,
      replies: performance.replies,
      postedAt: performance.postedAt,
    };
  });

  const selected = selectDictionAnchors(entries, pinnedIds);
  const active = selected.length >= VOICE_CORPUS_MIN_ANCHORS;
  if (active) {
    for (const entry of selected) {
      entry.dispositions = [...new Set<VoiceCorpusDisposition>([...entry.dispositions, 'diction_anchor'])];
      entry.selectionReasons.push('activated in the current diction corpus');
    }
  } else {
    selected.forEach((entry) => entry.selectionReasons.push(
      `eligible but inactive until ${VOICE_CORPUS_MIN_ANCHORS} anchors are available`,
    ));
  }

  const snapshotBasis = entries
    .map((entry) => `${entry.xTweetId}:${entry.contentHash}:${entry.dispositions.sort().join(',')}`)
    .sort()
    .join('|');
  const snapshotId = `voice-corpus-v${VOICE_CORPUS_SCHEMA_VERSION}-${stableHash(snapshotBasis)}`;
  const count = (disposition: VoiceCorpusDisposition) => entries.filter((entry) => entry.dispositions.includes(disposition)).length;
  const anchorCount = active ? count('diction_anchor') : 0;

  return {
    snapshotId,
    version: VOICE_CORPUS_SCHEMA_VERSION,
    active,
    targetAnchorCount: VOICE_CORPUS_TARGET_ANCHORS,
    minimumAnchorCount: VOICE_CORPUS_MIN_ANCHORS,
    anchorCount,
    topicSignalCount: count('topic_signal'),
    mechanicsOnlyCount: count('mechanics_only'),
    negativeCount: count('negative'),
    excludedCount: count('excluded'),
    knownGeneratedAnchorCount: entries.filter((entry) => (
      entry.provenance === 'known_clawfable_generated'
      && entry.dispositions.includes('diction_anchor')
    )).length,
    generatedAt,
    agentId,
    entries,
  };
}

export function applyVoiceCorpusMetadata(
  history: TweetPerformance[],
  snapshot: VoiceCorpusSnapshot,
): TweetPerformance[] {
  const entries = new Map(snapshot.entries.map((entry) => [entry.xTweetId, entry]));
  return history.map((performance) => {
    const entry = entries.get(String(performance.xTweetId));
    if (!entry) return performance;
    return {
      ...performance,
      authorshipProvenance: entry.provenance,
      authorshipConfidence: entry.authorshipConfidence,
      voiceCorpusDispositions: entry.dispositions,
      voiceCorpusVersion: snapshot.snapshotId,
    };
  });
}
