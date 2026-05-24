import type {
  ActionRewardBreakdown,
  AudienceSegment,
  CandidateCriticScores,
  CandidateFeatureTags,
  CreativeLane,
  ContentSourceLane,
  PerformanceCheckpoint,
  PromptStrategy,
  Tweet,
  TweetPerformance,
} from './types';

export interface HighValueReplyScore {
  score: number;
  reason: string;
  responseStrategy: 'answer_question' | 'add_distinction' | 'substantive_disagreement' | 'extend_context' | 'ignore_low_signal';
  lowSignal: boolean;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function weightedEngagement(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return entry.likes + (entry.retweets * 2) + (entry.replies * 1.5);
}

export function inferAudienceSegment(content: string, topic?: string | null): AudienceSegment {
  const text = `${topic || ''} ${content}`.toLowerCase();

  if (/\b(founder|startup|pre-seed|seed|gtm|product-market|runway|distribution)\b/.test(text)) return 'founders';
  if (/\b(ai|agent|llm|model|inference|eval|prompt|workflow|developer|engineer)\b/.test(text)) return 'ai_builders';
  if (/\b(biohack|metabolic|sleep|supplement|glucose|training|health|longevity)\b/.test(text)) return 'biohackers';
  if (/\b(investor|fund|vc|lp|portfolio|market|multiple|valuation)\b/.test(text)) return 'investors';
  if (/\b(creator|audience|newsletter|content|posting|distribution|community)\b/.test(text)) return 'creator_operators';
  if (/\b(system|infra|deployment|api|database|metrics|instrumentation|automation)\b/.test(text)) return 'technical_operators';
  if (/\?|\b(reply|argue|debate|what am i missing|serious question)\b/.test(text)) return 'reply_regulars';
  return 'generalists';
}

export function inferPromptStrategy({
  creativeLane,
  sourceLane,
  featureTags,
  content,
}: {
  creativeLane?: CreativeLane | null;
  sourceLane?: ContentSourceLane | null;
  featureTags: CandidateFeatureTags;
  content: string;
}): PromptStrategy {
  if (creativeLane === 'trend_riff' || sourceLane === 'trend_aligned_exploit' || sourceLane === 'trend_adjacent_explore') return 'trend_riff';
  if (creativeLane === 'weird_memetic') return 'weird';
  if (creativeLane === 'story_example' || featureTags.structure === 'story_arc' || featureTags.specificity === 'story_led') return 'story';
  if (creativeLane === 'contrarian_angle' || featureTags.hook === 'contrarian' || /\b(wrong|misread|underestimate|overrate)\b/i.test(content)) return 'contrarian';
  if (featureTags.specificity === 'data_driven' || featureTags.specificity === 'tactical') return 'high_specificity';
  if (featureTags.hook === 'question' || /\?/.test(content)) return 'reply_bait';
  return 'baseline';
}

export function scoreSlopRisk(content: string, featureTags: CandidateFeatureTags): number {
  const lower = content.toLowerCase();
  let score = 0.08;
  const genericPhrases = [
    'game changer',
    'unlock',
    'at the end of the day',
    'in today\'s world',
    'the future is',
    'most people don\'t realize',
    'here\'s the thing',
    'it depends',
    'not just',
    'the real question',
    'paradigm',
    'leverage',
  ];
  const genericHits = genericPhrases.filter((phrase) => lower.includes(phrase)).length;
  score += Math.min(0.36, genericHits * 0.08);
  if (featureTags.specificity === 'abstract') score += 0.18;
  if (featureTags.riskFlags.includes('thin')) score += 0.16;
  if (content.length > 220 && !/\b\d+[%x]?\b|\bfor example\b|\bbecause\b|\bwhen\b/i.test(content)) score += 0.12;
  if (/^(i think|in my opinion|here'?s|the thing is)/i.test(content.trim())) score += 0.12;
  if ((content.match(/\b(people|things|stuff|value|content|insight)\b/gi) || []).length >= 4) score += 0.1;
  if (featureTags.specificity === 'data_driven' || featureTags.specificity === 'tactical' || featureTags.specificity === 'story_led') score -= 0.12;
  if (featureTags.structure === 'story_arc' || featureTags.structure === 'comparison') score -= 0.06;
  return clamp(score);
}

export function scoreReplyPotential(content: string, featureTags: CandidateFeatureTags): number {
  const lower = content.toLowerCase();
  let score = 0.18;
  if (featureTags.hook === 'question') score += 0.22;
  if (/\?/.test(content)) score += 0.12;
  if (/\b(what am i missing|serious question|agree|disagree|debate|wrong|overrated|underrated)\b/.test(lower)) score += 0.18;
  if (featureTags.hook === 'contrarian' || featureTags.hook === 'callout') score += 0.12;
  if (featureTags.structure === 'comparison') score += 0.08;
  if (featureTags.riskFlags.includes('absolute_claim')) score += 0.06;
  if (featureTags.riskFlags.includes('salesy') || featureTags.riskFlags.includes('link')) score -= 0.14;
  return clamp(score);
}

export function scoreHighValueReply(mention: {
  text: string;
  authorUsername?: string | null;
  authorName?: string | null;
  createdAt?: string | null;
}, context: {
  topics?: string[];
  recentConversationTurns?: number;
} = {}): HighValueReplyScore {
  const text = mention.text.trim();
  const lower = text.toLowerCase();
  const topics = context.topics || [];
  let score = 0.22;
  const reasons: string[] = [];
  let responseStrategy: HighValueReplyScore['responseStrategy'] = 'extend_context';

  const hasQuestion = /\?|\b(how|why|what|where|when|which|can you|could you|would you|should i|thoughts on)\b/i.test(text);
  const asksForDepth = /\b(explain|example|proof|data|source|detail|breakdown|eval|production|workflow|walk me through|specific|why do you think)\b/i.test(text);
  const substantiveDisagreement = /\b(disagree|wrong|not true|missing|counterpoint|but|however|isn'?t|aren'?t)\b/i.test(text);
  const addsContext = /\b(because|i tried|we saw|from my experience|in practice|the issue is|the tradeoff)\b/i.test(text);
  const topicMatch = topics.some((topic) => topic.length > 1 && lower.includes(topic.toLowerCase()));
  const hasLinkOrSpam = /(https?:\/\/|airdrop|giveaway|dm me|follow back|check dm|promo code|whitelist)/i.test(text);
  const genericPraise = /^(nice|cool|lol|lmao|based|great|love this|facts|agree|true|same|wow)[.!?\s]*$/i.test(text);
  const tooShort = text.replace(/@\w+/g, '').trim().length < 14;

  if (hasQuestion) {
    score += 0.22;
    responseStrategy = 'answer_question';
    reasons.push('asks a question');
  }
  if (asksForDepth) {
    score += 0.18;
    responseStrategy = 'answer_question';
    reasons.push('asks for detail');
  }
  if (substantiveDisagreement) {
    score += 0.2;
    responseStrategy = 'substantive_disagreement';
    reasons.push('contains a substantive challenge');
  }
  if (addsContext) {
    score += 0.14;
    responseStrategy = responseStrategy === 'extend_context' ? 'add_distinction' : responseStrategy;
    reasons.push('adds context');
  }
  if (topicMatch) {
    score += 0.12;
    reasons.push('matches core topics');
  }
  if (text.length >= 80) {
    score += 0.08;
    reasons.push('has enough substance');
  }
  if (context.recentConversationTurns && context.recentConversationTurns > 0) {
    score += 0.06;
    reasons.push('continues an existing thread');
  }
  if (/\b(interesting|curious|nuance|tradeoff|edge case|example)\b/i.test(text)) {
    score += 0.08;
    reasons.push('invites nuance');
  }

  if (hasLinkOrSpam) {
    score -= 0.36;
    reasons.push('looks promotional');
  }
  if (genericPraise) {
    score -= 0.28;
    reasons.push('generic praise');
  }
  if (tooShort) {
    score -= 0.18;
    reasons.push('too short');
  }
  if ((lower.match(/@\w+/g) || []).length >= 3) {
    score -= 0.18;
    reasons.push('mention pile-on');
  }

  const clamped = Number(clamp(score).toFixed(3));
  const lowSignal = clamped < 0.5;
  return {
    score: clamped,
    reason: reasons.length > 0 ? reasons.join(', ') : 'general mention',
    responseStrategy: lowSignal ? 'ignore_low_signal' : responseStrategy,
    lowSignal,
  };
}

export function buildCriticScores({
  voiceScore,
  judgeScore,
  noveltyScore,
  audienceScore,
  slopScore,
  policyRiskScore,
  replyPotential,
}: {
  voiceScore: number;
  judgeScore: number;
  noveltyScore: number;
  audienceScore: number;
  slopScore: number;
  policyRiskScore: number;
  replyPotential: number;
}): CandidateCriticScores {
  const qualityPrior = clamp(judgeScore);
  return {
    voice: Number(clamp((voiceScore * 0.82) + (qualityPrior * 0.18)).toFixed(3)),
    audience: Number(clamp((audienceScore * 0.82) + (qualityPrior * 0.18)).toFixed(3)),
    novelty: Number(noveltyScore.toFixed(3)),
    slop: Number((1 - slopScore).toFixed(3)),
    factualRisk: Number((1 - policyRiskScore).toFixed(3)),
    replyPotential: Number(replyPotential.toFixed(3)),
  };
}

export function inferPerformanceCheckpoint(postedAt: string, checkedAt: string): PerformanceCheckpoint {
  const posted = Date.parse(postedAt);
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(checked)) return 'late';
  const ageMins = Math.max(0, (checked - posted) / 60000);
  if (ageMins <= 20) return 'initial_15m';
  if (ageMins <= 45) return 'early_30m';
  if (ageMins <= 150) return 'momentum_2h';
  if (ageMins <= 30 * 60) return 'full_24h';
  return 'late';
}

export function computeEarlyVelocityScore(entry: TweetPerformance): number {
  const checkpoint = entry.performanceCheckpoint || inferPerformanceCheckpoint(entry.postedAt, entry.checkedAt);
  const engagement = weightedEngagement(entry);
  const checkpointDivisor =
    checkpoint === 'initial_15m' ? 10 :
    checkpoint === 'early_30m' ? 16 :
    checkpoint === 'momentum_2h' ? 30 :
    checkpoint === 'full_24h' ? 80 :
    140;
  const replyShare = entry.replies / Math.max(1, entry.likes + entry.retweets + entry.replies);
  const rateBonus = entry.impressions > 0 ? Math.min(0.18, entry.engagementRate / 30) : 0;
  return Number(clamp((engagement / checkpointDivisor) + (replyShare * 0.18) + rateBonus).toFixed(3));
}

export function computeActionRewards(
  entry: TweetPerformance,
  baseline?: { avgLikes: number; avgRetweets: number } | null,
): ActionRewardBreakdown {
  const baselineLikes = Math.max(1, baseline?.avgLikes || 12);
  const baselineRetweets = Math.max(1, baseline?.avgRetweets || 2);
  const likeReward = clamp((entry.likes - baselineLikes) / baselineLikes * 0.22, -0.28, 0.42);
  const repostReward = clamp((entry.retweets - baselineRetweets) / baselineRetweets * 0.2, -0.24, 0.42);
  const replyReward = clamp(entry.replies / Math.max(2, baselineLikes * 0.35) * 0.18, 0, 0.32);
  const impressionReward = entry.impressions > 0 ? clamp(Math.log10(entry.impressions + 1) / 12, 0, 0.28) : 0;
  const engagementRateReward = clamp((entry.engagementRate - 2) / 20, -0.1, 0.25);
  const profileClickReward = 0;
  const followReward = 0;
  const negativeFeedbackRisk = entry.wasViral ? 0 : clamp((entry.creativeRiskScore || 0) * 0.12 + (entry.slopScore || 0) * 0.08, 0, 0.18);
  const total = clamp(
    likeReward + replyReward + repostReward + impressionReward + engagementRateReward + profileClickReward + followReward - negativeFeedbackRisk,
    -0.6,
    0.8,
  );

  return {
    likeReward: Number(likeReward.toFixed(3)),
    replyReward: Number(replyReward.toFixed(3)),
    repostReward: Number(repostReward.toFixed(3)),
    impressionReward: Number(impressionReward.toFixed(3)),
    engagementRateReward: Number(engagementRateReward.toFixed(3)),
    profileClickReward,
    followReward,
    negativeFeedbackRisk: Number(negativeFeedbackRisk.toFixed(3)),
    total: Number(total.toFixed(3)),
  };
}

export function summarizeReferenceBank(performanceHistory: TweetPerformance[]): string[] {
  return [...performanceHistory]
    .sort((a, b) => weightedEngagement(b) - weightedEngagement(a))
    .slice(0, 12)
    .map((entry) => {
      const firstLine = entry.content.split('\n').map((line) => line.trim()).find(Boolean) || entry.content;
      return `${entry.topic}/${entry.hook || 'hook'}: ${firstLine.slice(0, 110)}`;
    })
    .filter(Boolean)
    .slice(0, 6);
}

export function summarizeConversationInsights(performanceHistory: TweetPerformance[]): string[] {
  return [...performanceHistory]
    .filter((entry) => entry.replies >= 2)
    .sort((a, b) => b.replies - a.replies || weightedEngagement(b) - weightedEngagement(a))
    .slice(0, 6)
    .map((entry) => {
      const ratio = Math.round((entry.replies / Math.max(1, entry.likes + entry.retweets + entry.replies)) * 100);
      return `${entry.topic} posts with ${entry.hook || 'unknown'} hooks trigger replies (${entry.replies} replies, ${ratio}% reply share): "${entry.content.slice(0, 100)}"`;
    });
}

export function summarizeAudienceSegmentLessons(performanceHistory: TweetPerformance[]): string[] {
  const buckets = new Map<AudienceSegment, { total: number; count: number; wins: number }>();
  for (const entry of performanceHistory) {
    const segment = entry.targetAudienceSegment || inferAudienceSegment(entry.content, entry.topic);
    const current = buckets.get(segment) || { total: 0, count: 0, wins: 0 };
    const engagement = weightedEngagement(entry);
    current.total += engagement;
    current.count += 1;
    if (entry.wasViral || engagement >= 24) current.wins += 1;
    buckets.set(segment, current);
  }

  return [...buckets.entries()]
    .filter(([, stats]) => stats.count >= 2)
    .sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))
    .slice(0, 4)
    .map(([segment, stats]) => `${segment.replace(/_/g, ' ')}: avg ${Math.round(stats.total / stats.count)} engagement across ${stats.count} posts, ${stats.wins} wins.`);
}

export function summarizePromptStrategyLessons(performanceHistory: TweetPerformance[]): string[] {
  const buckets = new Map<PromptStrategy, { total: number; count: number; wins: number }>();
  for (const entry of performanceHistory) {
    const strategy = entry.promptStrategy || 'baseline';
    const current = buckets.get(strategy) || { total: 0, count: 0, wins: 0 };
    const engagement = weightedEngagement(entry);
    current.total += engagement;
    current.count += 1;
    if (entry.wasViral || engagement >= 24) current.wins += 1;
    buckets.set(strategy, current);
  }

  return [...buckets.entries()]
    .filter(([, stats]) => stats.count >= 2)
    .sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))
    .slice(0, 4)
    .map(([strategy, stats]) => `${strategy.replace(/_/g, ' ')}: avg ${Math.round(stats.total / stats.count)} engagement across ${stats.count} posts, ${stats.wins} wins.`);
}

export function tweetAudienceSegment(tweet: Pick<Tweet, 'targetAudienceSegment' | 'content' | 'topic'>): AudienceSegment {
  return tweet.targetAudienceSegment || inferAudienceSegment(tweet.content, tweet.topic);
}
