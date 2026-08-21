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
import { getAccountTopicPolicyIssue } from './account-topic-policy';
import { buildAntiFundPortfolioContext, findSingleAntiFundPortfolioCompany } from './antifund-portfolio';

export const VOICE_CORPUS_SCHEMA_VERSION = 2;
export const VOICE_CORPUS_TARGET_ANCHORS = 40;
export const VOICE_CORPUS_MAX_ANCHORS = 50;
export const VOICE_CORPUS_MIN_ANCHORS = 12;

const NEGATIVE_SIGNAL_TYPES = new Set([
  'deleted_from_queue',
  'deleted_from_x',
  'taste_less_like_this',
  'x_post_rejected',
]);

const PROMO_PATTERN = /\b(?:sign up|waitlist|book a demo|available now|launching today|new episode|follow me|subscribe|use code|new interview|full interview|new video|watch (?:the|our)|listen to|rt this post|sold out|get yours|merch|happy to (?:back|support|invest)|proud to (?:back|support|invest)|(?:would|would really|would absolutely) love to (?:back|support|invest|amplify)|invest and amplify|(?:very )?happy (?:investor|customer|backer)|congrats(?:ulations)? (?:to|@)|our portfolio company|we (?:just )?invested)\b/i;
const MEDIA_CAPTION_PATTERN = /\b(?:watch|listen|interview|podcast|pod|episode|video|timestamps?|full (?:conversation|breakdown)|link (?:in|below)|in action|i remember this (?:trip|moment|photo|clip)|look at this|watch this)\b/i;
const QUOTATION_PATTERN = /^(?:["'\u201c\u2018].{20,}["'\u201d\u2019](?:\s*[-\u2014].*)?|(?:quote|from)[:\s])/i;
const TRAILING_FRAGMENT_PATTERN = /(?:,|&|:|;|\b(?:and|or|the|a|an|to|of|for|with|is|are|was|were|has|have|that|which|because|when|if|into|more|mega))\s*$/i;
const CONTEXT_DEPENDENT_LINK_OPENING = /^(?:sounds about right|beasts\b|the names\b|this\b|that\b|these\b|those\b|it\b|they\b|them\b|he\b|she\b|pomp is right\b|just\b[^.!?\n]{0,120}\b(?:them|him|her)\b)/i;

export function getVoiceCorpusTextSurfaceExclusions(content: string): string[] {
  const trimmed = content.trim();
  const prose = trimmed.replace(/https?:\/\/\S+/gi, ' ').replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = normalizeWords(prose).length;
  const timestampLines = trimmed.split('\n').filter((line) => /^\s*\d{1,2}:\d{2}(?:\s*[-\u2013\u2014]|\s+)/.test(line)).length;
  const hasLink = /https?:\/\/\S+/i.test(trimmed);
  const strippedEnding = trimmed.replace(/https?:\/\/\S+/gi, ' ').trim();
  const firstProseLine = strippedEnding.split('\n').map((line) => line.trim()).find(Boolean) || '';
  const attributedModelOutput = /\b(?:i\s+)?asked\s+@?(?:chatgpt|claude|gemini|grok|copilot)\b/i.test(trimmed);
  const modelOutputLabelLines = trimmed.split('\n').filter((line) => (
    /^\s*(?:overall|assessment|answer|response|analysis|score|rating|face|physique|style|summary)\s*:/i.test(line)
  )).length;
  const reasons: string[] = [];

  if (PROMO_PATTERN.test(trimmed)) reasons.push('promotional post');
  if (QUOTATION_PATTERN.test(trimmed)) reasons.push('quotation rather than native prose');
  if (
    attributedModelOutput
    && (modelOutputLabelLines >= 2 || /\bthe (?:assessment|answer|response|analysis)\s*:/i.test(trimmed))
  ) {
    reasons.push('quoted model output rather than native prose');
  }
  if (timestampLines >= 2 || (hasLink && MEDIA_CAPTION_PATTERN.test(trimmed))) {
    reasons.push('media-dependent caption');
  }
  if (hasLink && CONTEXT_DEPENDENT_LINK_OPENING.test(firstProseLine)) {
    reasons.push('media-dependent caption');
  }
  if (hasLink && wordCount < 16) reasons.push('media or link dependent caption');
  if (
    (strippedEnding.length >= 120 && TRAILING_FRAGMENT_PATTERN.test(strippedEnding))
    || /(?:\.\.\.|\u2026)$/.test(strippedEnding)
  ) {
    reasons.push('possibly truncated or incomplete text');
  }
  return [...new Set(reasons)];
}

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
  accountTopicIssue: string | null,
): string[] {
  const content = performance.content.trim();
  const prose = content.replace(/https?:\/\/\S+/gi, ' ').replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = normalizeWords(prose).length;
  const reasons: string[] = getVoiceCorpusTextSurfaceExclusions(content);

  if (provenance === 'known_clawfable_generated') reasons.push('known Clawfable-generated post');
  if (provenance === 'unknown') reasons.push('authorship provenance is uncertain');
  if (negative) reasons.push('explicit negative operator signal');
  if (blocked) reasons.push('explicitly blocked example');
  if (!content || content.length < 25 || wordCount < 6) reasons.push('insufficient standalone prose');
  if (/^@\w+/.test(content)) reasons.push('reply-shaped post');
  if (performance.referenceType) reasons.push(`${performance.referenceType} post`);
  if (performance.hasMedia) reasons.push('media-dependent caption');
  if (performance.hasMedia && wordCount < 18) reasons.push('media-dependent caption');
  if (performance.isTextComplete === false) reasons.push('incomplete X text payload');
  if (performance.format === 'unknown' || ['general', 'unknown'].includes((performance.topic || '').toLowerCase())) {
    reasons.push('classification backlog is incomplete');
  }
  if (slopScore >= 0.32) reasons.push(`slop risk ${slopScore.toFixed(2)}`);
  if (patternRisk >= 0.28) reasons.push(`generated-pattern risk ${patternRisk.toFixed(2)}`);
  if (accountTopicIssue) reasons.push(accountTopicIssue);
  return [...new Set(reasons)];
}

function entrySignature(entry: VoiceCorpusEntry): string {
  const length = entry.content.length < 120 ? 'short' : entry.content.length < 320 ? 'medium' : 'long';
  return `${entry.featureTags.hook}:${entry.featureTags.structure}:${entry.featureTags.tone}:${length}`;
}

function isPinnableHeuristicExclusion(reason: string): boolean {
  return /^(?:slop risk|generated-pattern risk)\s/i.test(reason);
}

function hasPinnedHeuristicOverride(entry: VoiceCorpusEntry, pinnedIds: Set<string>): boolean {
  return pinnedIds.has(entry.xTweetId)
    && entry.exclusionReasons.length > 0
    && entry.exclusionReasons.every(isPinnableHeuristicExclusion);
}

function selectDictionAnchors(entries: VoiceCorpusEntry[], pinnedIds: Set<string>): VoiceCorpusEntry[] {
  const eligible = entries
    .filter((entry) => (
      entry.dispositions.includes('topic_signal')
      && (entry.exclusionReasons.length === 0 || hasPinnedHeuristicOverride(entry, pinnedIds))
    ))
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
  accountHandle,
  generatedAt = new Date().toISOString(),
}: {
  agentId: string;
  history: TweetPerformance[];
  tweets: Tweet[];
  postLog: PostLogEntry[];
  signals: LearningSignal[];
  curation: ManualExampleCuration;
  accountHandle?: string | null;
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
    const topicContext = `${performance.topic || ''} ${performance.content}`;
    const portfolioCompany = findSingleAntiFundPortfolioCompany(topicContext);
    const accountTopicIssue = getAccountTopicPolicyIssue(
      accountHandle,
      topicContext,
      null,
      portfolioCompany ? buildAntiFundPortfolioContext(portfolioCompany, 'constructive_conviction') : null,
    );
    const exclusions = exclusionReasons(
      performance,
      provenance,
      negative,
      blocked,
      slopScore,
      generatedPatternRisk,
      accountTopicIssue,
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
    const pinnedHeuristicOverride = pinnedIds.has(xTweetId)
      && exclusions.length > 0
      && exclusions.every(isPinnableHeuristicExclusion);
    if (provenance === 'known_clawfable_generated') dispositions.push('mechanics_only');
    else if (provenance !== 'unknown' && !negative && !blocked && !accountTopicIssue) dispositions.push('topic_signal');
    if (negative || blocked) dispositions.push('negative');
    if (exclusions.length > 0 && !pinnedHeuristicOverride && !dispositions.includes('mechanics_only')) dispositions.push('excluded');

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
        pinnedHeuristicOverride ? 'manual pin overrides heuristic style-risk exclusion' : '',
      ].filter(Boolean),
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
  for (const entry of selected) {
    entry.dispositions = [...new Set<VoiceCorpusDisposition>([...entry.dispositions, 'diction_anchor'])];
    if (active) {
      entry.selectionReasons.push('activated in the current diction corpus');
    } else {
      entry.selectionReasons.push(
        `eligible but inactive until ${VOICE_CORPUS_MIN_ANCHORS} anchors are available`,
      );
    }
  }

  const snapshotBasis = entries
    .map((entry) => `${entry.xTweetId}:${entry.contentHash}:${entry.dispositions.sort().join(',')}`)
    .sort()
    .join('|');
  const snapshotId = `voice-corpus-v${VOICE_CORPUS_SCHEMA_VERSION}-${stableHash(snapshotBasis)}`;
  const count = (disposition: VoiceCorpusDisposition) => entries.filter((entry) => entry.dispositions.includes(disposition)).length;
  const anchorCount = count('diction_anchor');

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
