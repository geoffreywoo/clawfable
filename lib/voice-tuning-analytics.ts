import type { LearningSignal, Tweet, TweetPerformance } from './types';

export type VoiceSentiment = 'positive' | 'neutral' | 'spicy' | 'negative';

export interface VoiceTuningAnalytics {
  summary: {
    totalSamples: number;
    bestTone: string | null;
    riskiestTone: string | null;
    topicOpportunity: string | null;
    sentimentBalance: Record<VoiceSentiment, number>;
  };
  toneBreakdown: Array<{
    tone: string;
    count: number;
    avgEngagement: number;
    approvalRate: number | null;
    deleteRate: number | null;
  }>;
  sentimentBreakdown: Array<{
    sentiment: VoiceSentiment;
    count: number;
    avgEngagement: number;
    share: number;
  }>;
  voiceShapeBreakdown: Array<{
    shape: string;
    count: number;
    avgEngagement: number;
    share: number;
  }>;
  topicMatrix: Array<{
    topic: string;
    count: number;
    avgEngagement: number;
    topTone: string | null;
    sentiment: VoiceSentiment | null;
    recommendation: string;
  }>;
  recommendations: string[];
}

type TweetLike = Pick<
  Tweet,
  'id' | 'xTweetId' | 'content' | 'topic' | 'hookType' | 'toneType' | 'structureType' | 'styleMode'
>;

type Bucket = {
  count: number;
  totalEngagement: number;
};

const SENTIMENTS: VoiceSentiment[] = ['positive', 'neutral', 'spicy', 'negative'];

function cleanLabel(value: string | null | undefined, fallback: string): string {
  const label = String(value || '').trim();
  if (!label || label === 'unknown') return fallback;
  return label;
}

function weightedEngagement(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return (entry.likes || 0) + ((entry.retweets || 0) * 2) + ((entry.replies || 0) * 1.5);
}

function addBucket(map: Map<string, Bucket>, key: string, engagement: number) {
  const current = map.get(key) || { count: 0, totalEngagement: 0 };
  current.count += 1;
  current.totalEngagement += engagement;
  map.set(key, current);
}

function avg(bucket: Bucket): number {
  return Math.round(bucket.totalEngagement / Math.max(1, bucket.count));
}

function tweetForEntry(
  entry: TweetPerformance,
  tweetById: Map<string, TweetLike>,
  tweetByXId: Map<string, TweetLike>,
): TweetLike | null {
  return (
    (entry.tweetId ? tweetById.get(String(entry.tweetId)) : null) ||
    (entry.xTweetId ? tweetByXId.get(String(entry.xTweetId)) : null) ||
    null
  );
}

function toneForEntry(entry: TweetPerformance, tweet: TweetLike | null): string {
  return cleanLabel(entry.tone || tweet?.toneType, 'unclassified');
}

function topicForEntry(entry: TweetPerformance, tweet: TweetLike | null): string {
  return cleanLabel(entry.topic || tweet?.topic, 'general');
}

function shapeForEntry(entry: TweetPerformance, tweet: TweetLike | null): string {
  const hook = cleanLabel(entry.hook || tweet?.hookType, '');
  if (['contrarian', 'callout', 'bold_claim'].includes(hook)) return 'strong take';
  if (hook === 'data_point') return 'data point';
  if (hook === 'listicle') return 'list';
  if (hook === 'how_to') return 'how-to';
  if (hook === 'story' || hook === 'confession') return 'story';
  if (hook) return hook.replace(/_/g, ' ');

  const structure = cleanLabel(entry.structure || tweet?.structureType, '');
  if (structure === 'single_punch') return 'single punch';
  if (structure === 'question_led') return 'question-led';
  if (structure === 'story_arc') return 'story';
  if (structure) return structure.replace(/_/g, ' ');
  return 'unclassified';
}

export function inferVoiceSentiment(entry: TweetPerformance, tweet?: TweetLike | null): VoiceSentiment {
  const content = `${entry.content || tweet?.content || ''}`.toLowerCase();
  const tone = cleanLabel(entry.tone || tweet?.toneType, 'unknown');
  const styleMode = entry.styleMode || tweet?.styleMode;

  const spicyMarkers = [
    'actually',
    'brutal',
    'chaos',
    'delusional',
    'fake',
    'grift',
    'hot take',
    'most people',
    'nobody',
    'scam',
    'unhinged',
    'wrong',
  ];
  const negativeMarkers = ['bad', 'broken', 'dead', 'decline', 'fail', 'mistake', 'problem', 'worse'];
  const positiveMarkers = ['better', 'beautiful', 'compound', 'great', 'love', 'useful', 'win', 'works'];

  if (
    styleMode === 'shitpoast' ||
    ['provocative', 'sarcastic', 'urgent'].includes(tone) ||
    spicyMarkers.some((marker) => content.includes(marker))
  ) {
    return 'spicy';
  }
  if (negativeMarkers.some((marker) => content.includes(marker))) return 'negative';
  if (['earnest', 'educational', 'playful'].includes(tone) || positiveMarkers.some((marker) => content.includes(marker))) {
    return 'positive';
  }
  return 'neutral';
}

function signalOutcomeBuckets(
  signals: LearningSignal[],
  tweets: TweetLike[],
): Map<string, { approvals: number; rejections: number; deletes: number; posts: number }> {
  const tweetById = new Map(tweets.map((tweet) => [String(tweet.id), tweet]));
  const tweetByXId = new Map(
    tweets
      .filter((tweet) => tweet.xTweetId)
      .map((tweet) => [String(tweet.xTweetId), tweet]),
  );
  const buckets = new Map<string, { approvals: number; rejections: number; deletes: number; posts: number }>();
  const ensure = (tone: string) => {
    const existing = buckets.get(tone);
    if (existing) return existing;
    const next = { approvals: 0, rejections: 0, deletes: 0, posts: 0 };
    buckets.set(tone, next);
    return next;
  };

  for (const signal of signals) {
    const tweet = (
      (signal.tweetId ? tweetById.get(String(signal.tweetId)) : null) ||
      (signal.xTweetId ? tweetByXId.get(String(signal.xTweetId)) : null)
    );
    const metadataTone = typeof signal.metadata?.tone === 'string'
      ? signal.metadata.tone
      : typeof signal.metadata?.toneType === 'string'
        ? signal.metadata.toneType
        : null;
    const tone = cleanLabel(metadataTone || tweet?.toneType, 'unclassified');
    const bucket = ensure(tone);
    if (['approved_without_edit', 'edited_before_queue', 'edited_before_post'].includes(signal.signalType)) {
      bucket.approvals += 1;
    }
    if (['deleted_from_queue', 'deleted_from_x', 'reply_rejected', 'x_post_rejected'].includes(signal.signalType)) {
      bucket.rejections += 1;
    }
    if (['deleted_from_queue', 'deleted_from_x'].includes(signal.signalType)) {
      bucket.deletes += 1;
    }
    if (['reply_posted', 'x_post_succeeded'].includes(signal.signalType)) {
      bucket.posts += 1;
    }
  }

  return buckets;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function recommendTopic(
  topic: string,
  count: number,
  avgEngagement: number,
  overallAvg: number,
  topTone: string | null,
  sentiment: VoiceSentiment | null,
): string {
  const toneCopy = topTone ? topTone.replace(/_/g, ' ') : 'stronger';
  if (count <= 1 && avgEngagement >= overallAvg) {
    return `Promising but under-tested. Try 2 more with a ${toneCopy} angle.`;
  }
  if (avgEngagement >= overallAvg * 1.15) {
    return `Scale ${topic} with ${toneCopy}${sentiment ? `, ${sentiment}` : ''} posts.`;
  }
  if (avgEngagement <= overallAvg * 0.75) {
    return `Reduce volume unless the hook is much sharper.`;
  }
  return `Keep in rotation, but vary tone and opening shape.`;
}

export function buildVoiceTuningAnalytics(input: {
  performance: TweetPerformance[];
  signals?: LearningSignal[];
  tweets?: TweetLike[];
}): VoiceTuningAnalytics {
  const performance = input.performance.filter((entry) => entry.content || entry.tweetId || entry.xTweetId);
  const signals = input.signals || [];
  const tweets = input.tweets || [];
  const tweetById = new Map(tweets.map((tweet) => [String(tweet.id), tweet]));
  const tweetByXId = new Map(
    tweets
      .filter((tweet) => tweet.xTweetId)
      .map((tweet) => [String(tweet.xTweetId), tweet]),
  );

  const toneMap = new Map<string, Bucket>();
  const sentimentMap = new Map<VoiceSentiment, Bucket>();
  const shapeMap = new Map<string, Bucket>();
  const topicMap = new Map<string, Bucket>();
  const topicToneMap = new Map<string, Map<string, Bucket>>();
  const topicSentimentMap = new Map<string, Map<VoiceSentiment, Bucket>>();

  for (const sentiment of SENTIMENTS) {
    sentimentMap.set(sentiment, { count: 0, totalEngagement: 0 });
  }

  for (const entry of performance) {
    const tweet = tweetForEntry(entry, tweetById, tweetByXId);
    const engagement = weightedEngagement(entry);
    const tone = toneForEntry(entry, tweet);
    const topic = topicForEntry(entry, tweet);
    const sentiment = inferVoiceSentiment(entry, tweet);
    const shape = shapeForEntry(entry, tweet);

    addBucket(toneMap, tone, engagement);
    addBucket(sentimentMap, sentiment, engagement);
    addBucket(shapeMap, shape, engagement);
    addBucket(topicMap, topic, engagement);

    const toneBuckets = topicToneMap.get(topic) || new Map<string, Bucket>();
    addBucket(toneBuckets, tone, engagement);
    topicToneMap.set(topic, toneBuckets);

    const sentimentBuckets = topicSentimentMap.get(topic) || new Map<VoiceSentiment, Bucket>();
    addBucket(sentimentBuckets, sentiment, engagement);
    topicSentimentMap.set(topic, sentimentBuckets);
  }

  const totalSamples = performance.length;
  const totalEngagement = performance.reduce((sum, entry) => sum + weightedEngagement(entry), 0);
  const overallAvg = totalSamples > 0 ? totalEngagement / totalSamples : 0;
  const signalBuckets = signalOutcomeBuckets(signals, tweets);

  const toneBreakdown = Array.from(toneMap.entries())
    .map(([tone, bucket]) => {
      const outcomes = signalBuckets.get(tone);
      const approvalDenominator = (outcomes?.approvals || 0) + (outcomes?.rejections || 0);
      const deleteDenominator = (outcomes?.deletes || 0) + (outcomes?.posts || 0);
      return {
        tone,
        count: bucket.count,
        avgEngagement: avg(bucket),
        approvalRate: approvalDenominator > 0 ? pct(outcomes?.approvals || 0, approvalDenominator) : null,
        deleteRate: deleteDenominator > 0 ? pct(outcomes?.deletes || 0, deleteDenominator) : null,
      };
    })
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.count - a.count)
    .slice(0, 6);

  const sentimentBreakdown = SENTIMENTS
    .map((sentiment) => {
      const bucket = sentimentMap.get(sentiment) || { count: 0, totalEngagement: 0 };
      return {
        sentiment,
        count: bucket.count,
        avgEngagement: bucket.count > 0 ? avg(bucket) : 0,
        share: pct(bucket.count, totalSamples),
      };
    });

  const voiceShapeBreakdown = Array.from(shapeMap.entries())
    .map(([shape, bucket]) => ({
      shape,
      count: bucket.count,
      avgEngagement: avg(bucket),
      share: pct(bucket.count, totalSamples),
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.count - a.count)
    .slice(0, 5);

  const bestToneForTopic = (topic: string): string | null => {
    const rows = Array.from(topicToneMap.get(topic)?.entries() || []);
    return rows.sort((a, b) => avg(b[1]) - avg(a[1]) || b[1].count - a[1].count)[0]?.[0] || null;
  };
  const dominantSentimentForTopic = (topic: string): VoiceSentiment | null => {
    const rows = Array.from(topicSentimentMap.get(topic)?.entries() || []);
    return rows.sort((a, b) => b[1].count - a[1].count || avg(b[1]) - avg(a[1]))[0]?.[0] || null;
  };

  const topicMatrix = Array.from(topicMap.entries())
    .map(([topic, bucket]) => {
      const avgEngagement = avg(bucket);
      const topTone = bestToneForTopic(topic);
      const sentiment = dominantSentimentForTopic(topic);
      return {
        topic,
        count: bucket.count,
        avgEngagement,
        topTone,
        sentiment,
        recommendation: recommendTopic(topic, bucket.count, avgEngagement, overallAvg, topTone, sentiment),
      };
    })
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.count - a.count)
    .slice(0, 6);

  const spicy = sentimentBreakdown.find((row) => row.sentiment === 'spicy');
  const neutral = sentimentBreakdown.find((row) => row.sentiment === 'neutral');
  const bestTone = toneBreakdown[0]?.tone || null;
  const riskiestTone = [...toneBreakdown]
    .filter((row) => row.deleteRate !== null || row.avgEngagement < overallAvg * 0.75)
    .sort((a, b) => (b.deleteRate || 0) - (a.deleteRate || 0) || a.avgEngagement - b.avgEngagement)[0]?.tone || null;
  const topicOpportunity = topicMatrix[0]?.topic || null;
  const underusedShape = voiceShapeBreakdown.find((row) => row.count <= 2 && row.avgEngagement >= overallAvg);
  const recommendations: string[] = [];

  if (bestTone && topicOpportunity) {
    recommendations.push(`Lean into ${bestTone.replace(/_/g, ' ')} takes on ${topicOpportunity}; that pairing is carrying the current sample.`);
  }
  if ((neutral?.share || 0) >= 50 && (spicy?.avgEngagement || 0) >= overallAvg) {
    recommendations.push('The mix is drifting neutral. Add more spicy/contrarian slots while keeping the same proven topics.');
  } else if ((spicy?.share || 0) < 25 && (spicy?.avgEngagement || 0) >= overallAvg) {
    recommendations.push('Spicy posts are earning their slot. Raise the target toward 25-35% of the batch.');
  } else if ((spicy?.share || 0) > 60 && (spicy?.avgEngagement || 0) < overallAvg) {
    recommendations.push('Spice is overrepresented relative to results. Keep the punch, but shift some slots back to precise analysis.');
  }
  if (underusedShape) {
    recommendations.push(`${underusedShape.shape} is under-tested but outperforming. Run a small exploration lane before changing the whole voice.`);
  }
  if (riskiestTone && riskiestTone !== bestTone) {
    recommendations.push(`Watch ${riskiestTone.replace(/_/g, ' ')} tone; it has weaker results or higher deletion risk in this window.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Keep collecting samples, but avoid making big voice changes until one tone or topic clearly separates.');
  }

  return {
    summary: {
      totalSamples,
      bestTone,
      riskiestTone,
      topicOpportunity,
      sentimentBalance: {
        positive: sentimentBreakdown.find((row) => row.sentiment === 'positive')?.share || 0,
        neutral: neutral?.share || 0,
        spicy: spicy?.share || 0,
        negative: sentimentBreakdown.find((row) => row.sentiment === 'negative')?.share || 0,
      },
    },
    toneBreakdown,
    sentimentBreakdown,
    voiceShapeBreakdown,
    topicMatrix,
    recommendations,
  };
}
