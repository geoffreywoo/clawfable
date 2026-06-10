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

export interface TasteRiskAssessment {
  score: number;
  provocationScore: number;
  action: 'allow' | 'review' | 'block';
  embarrassing: boolean;
  reasons: string[];
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
    'moat',
    'compounds',
    'feedback loop',
    'default playbook',
    'legacy assumption',
    'people are sleeping on',
    'the winners will be',
    'the common mistake',
    'most takes',
    'real edge',
    'real moat',
  ];
  const genericHits = genericPhrases.filter((phrase) => lower.includes(phrase)).length;
  score += Math.min(0.42, genericHits * 0.08);

  const syntheticCadencePatterns = [
    /\bnot\s+[^.\n]{3,80}\bbut\b/i,
    /\bnot\s+[^.\n]{3,80}\bit'?s\b/i,
    /\bthe (real|actual) (edge|moat|bottleneck|question|shift|winners?)\b/i,
    /\bmost people (don'?t realize|miss|think|are still)\b/i,
    /\bpeople (are still|keep|confuse|optimize for)\b/i,
    /\bthe winners will be\b/i,
    /\bthis is (how|why|where) .* compounds?\b/i,
    /\bthat is the (shift|edge|moat|bottleneck|point)\b/i,
  ];
  const cadenceHits = syntheticCadencePatterns.filter((pattern) => pattern.test(content)).length;
  score += Math.min(0.3, cadenceHits * 0.1);

  const abstractPowerWords = lower.match(/\b(leverage|signal|optics|moat|edge|compounds?|flywheel|narrative|iteration|feedback loops?|systems?|velocity|incentives|playbook)\b/g) || [];
  const hasConcreteAnchor = /\b\d+([.,]\d+)?\s?(%|x|k|m|b)?\b|\$\d|\b(for example|because|when|after|before|we saw|i saw|a founder|a team|a buyer|a user|the bug|the metric|the eval|screenshot|customer|workflow)\b/i.test(content);
  if (abstractPowerWords.length >= 4 && !hasConcreteAnchor) score += 0.18;
  if (abstractPowerWords.length >= 6) score += 0.1;

  const numberedLines = content.split('\n').filter((line) => /^\s*\d+\.\s+\S/.test(line)).length;
  if (numberedLines >= 4 && !hasConcreteAnchor) score += 0.12;

  if (featureTags.specificity === 'abstract') score += 0.18;
  if (featureTags.riskFlags.includes('thin')) score += 0.16;
  if (content.length > 220 && !hasConcreteAnchor) score += 0.12;
  if (/^(i think|in my opinion|here'?s|the thing is)/i.test(content.trim())) score += 0.12;
  if ((content.match(/\b(people|things|stuff|value|content|insight)\b/gi) || []).length >= 4) score += 0.1;
  if (featureTags.specificity === 'data_driven' || featureTags.specificity === 'tactical' || featureTags.specificity === 'story_led') score -= 0.12;
  if (featureTags.structure === 'story_arc' || featureTags.structure === 'comparison') score -= 0.06;
  if (hasConcreteAnchor && cadenceHits <= 1 && genericHits <= 2) score -= 0.08;
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

export function scoreConversationValue(content: string, featureTags: CandidateFeatureTags): number {
  const text = content.trim();
  const lower = text.toLowerCase();
  let score = 0.34;

  const hasQuestion = /\?/.test(text) || featureTags.hook === 'question';
  const hasMechanism = /\b(because|when|if|after|before|until|tradeoff|constraint|failure mode|recovery path|example|for instance)\b/i.test(text);
  const hasSpecificProof = /\b\d+([.,]\d+)?\s?(%|x|k|m|b)?\b|\$\d|\b(data|benchmark|case study|metric|eval|workflow|demo|production)\b/i.test(text);
  const hasDistinction = /\b(not|isn't|aren't)\b.{0,80}\b(but|because)\b|\bvs\b| versus | compared to |\binstead of\b/i.test(text);
  const asksForUsefulInput = /\b(where does this break|what am i missing|what would you change|which part is wrong|what would make this fail|edge case)\b/i.test(text);
  const genericBait = /\b(thoughts\??|what do you think\??|agree or disagree\??|reply below|drop your|hot take\??)\b/i.test(text);

  if (hasQuestion) score += 0.1;
  if (hasMechanism) score += 0.16;
  if (hasSpecificProof || ['concrete', 'data_driven', 'tactical', 'story_led'].includes(featureTags.specificity)) score += 0.16;
  if (hasDistinction || featureTags.structure === 'comparison') score += 0.12;
  if (asksForUsefulInput) score += 0.12;
  if (featureTags.hook === 'contrarian' && hasMechanism) score += 0.08;
  if (text.length >= 80 && text.length <= 420) score += 0.08;

  if (genericBait) score -= 0.24;
  if (hasQuestion && text.length < 70) score -= 0.18;
  if (featureTags.specificity === 'abstract') score -= 0.12;
  if (featureTags.riskFlags.includes('thin')) score -= 0.14;
  if (featureTags.riskFlags.includes('salesy') || featureTags.riskFlags.includes('link')) score -= 0.16;
  if ((lower.match(/\b(people|things|stuff|content|value|interesting)\b/g) || []).length >= 3) score -= 0.08;

  return Number(clamp(score).toFixed(3));
}

export function scoreHighValueReply(mention: {
  text: string;
  authorUsername?: string | null;
  authorName?: string | null;
  createdAt?: string | null;
}, context: {
  topics?: string[];
  recentConversationTurns?: number;
  relationshipHandles?: Array<{ handle: string; interactions?: number; avgEngagement?: number }>;
} = {}): HighValueReplyScore {
  const text = mention.text.trim();
  const lower = text.toLowerCase();
  const topics = context.topics || [];
  const normalizedAuthor = (mention.authorUsername || mention.authorName || '').replace(/^@/, '').trim().toLowerCase();
  const relationship = normalizedAuthor
    ? context.relationshipHandles?.find((entry) => entry.handle.replace(/^@/, '').toLowerCase() === normalizedAuthor)
    : null;
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
  if (relationship) {
    score += Math.min(0.18, 0.08 + (relationship.interactions || 0) * 0.015 + (relationship.avgEngagement || 0) / 600);
    reasons.push('known relationship target');
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

export function getReplyOptOutReason(text: string): string | null {
  const lower = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return null;

  const optOutPatterns: Array<[RegExp, string]> = [
    [/\b(?:do not|don't|dont)\s+(?:reply|respond|tag|mention|contact|dm|message)\b/, 'asked not to receive replies or mentions'],
    [/\bstop\s+(?:replying|responding|tagging|mentioning|contacting|dm(?:ing|'ing)?|messaging)\b/, 'asked the account to stop contacting them'],
    [/\b(?:please\s+)?stop\s+(?:replying|tagging|mentioning|contacting)\s+(?:me|us)\b/, 'asked the account to stop contacting them'],
    [/\b(?:unsubscribe|opt\s*out|remove\s+me|leave\s+me\s+alone)\b/, 'explicit opt-out request'],
    [/\bno\s+more\s+(?:replies|mentions|tags|dms|messages)\b/, 'asked for no more automated contact'],
  ];

  const matched = optOutPatterns.find(([pattern]) => pattern.test(lower));
  return matched ? matched[1] : null;
}

export function getAuthorityProofIssue(content: string): string | null {
  const text = content.trim();
  if (!text) return null;

  const broadCertainty = /\b(guaranteed|always|never|everyone|everybody|nobody|no one)\b|\b(the market|founders|investors|operators|creators|builders)\b.{0,90}\b(wrong|miss(?:ing)?|misread|underestimate|overrate|obsolete|dead)\b/i.test(text);
  if (!broadCertainty) return null;

  const hasSupport = /\b(because|for example|for instance|data|proof|benchmark|case study|we saw|i saw|i tried|after|when|since|the reason|mechanism|incentive|bottleneck|tradeoff|constraint|failure mode|recovery path|eval|metric)\b|\b\d+[%x]?\b|\$\d/i.test(text);
  if (hasSupport) return null;

  return 'Authority gate held this draft because broad certainty claims need proof, a mechanism, or a concrete example before autoposting.';
}

export function assessTasteRisk(content: string, options: {
  surface: 'post' | 'reply';
  mentionText?: string | null;
  autonomyMode?: 'safe' | 'balanced' | 'explore' | null;
  policyRiskScore?: number | null;
  creativeRiskScore?: number | null;
  slopScore?: number | null;
  voiceScore?: number | null;
  highValueScore?: number | null;
}): TasteRiskAssessment {
  const text = content.trim();
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  let risk = 0.08;
  let provocation = 0.08;

  if (!text) {
    return { score: 1, provocationScore: 0, action: 'block', embarrassing: true, reasons: ['empty output'] };
  }

  const genericPhrases = [
    'game changer',
    'unlock',
    'at the end of the day',
    'the future is',
    'here\'s the thing',
    'the real question',
    'paradigm shift',
    '10x your',
  ];
  const genericHits = genericPhrases.filter((phrase) => lower.includes(phrase)).length;
  if (genericHits > 0) {
    risk += Math.min(0.24, genericHits * 0.08);
    reasons.push('generic phrasing');
  }

  if (/(idiot|moron|retard|kill yourself|kys|loser|clown|stupid)\b/i.test(text)) {
    risk += 0.5;
    provocation += 0.22;
    reasons.push('needlessly personal or abusive');
  }
  if (/\b(guaranteed|always|never|everyone knows|nobody understands)\b/i.test(text)) {
    risk += 0.12;
    provocation += 0.1;
    reasons.push('over-certain claim');
  }
  if (/\b(wrong|overrated|underrated|delusional|cope|fraud|scam)\b/i.test(text)) {
    provocation += 0.18;
  }
  if (/\b(most people|everyone|nobody|the market|founders|investors)\b.{0,90}\b(wrong|miss|misread|underestimate|overrate)\b/i.test(text)) {
    provocation += 0.18;
  }
  if (/[A-Z]{8,}/.test(text) || /!!{2,}/.test(text)) {
    risk += 0.12;
    provocation += 0.08;
    reasons.push('shouty formatting');
  }
  if (options.surface === 'reply') {
    if (/^(thanks|agree|true|facts|nice|lol)[.!?\s]*$/i.test(text)) {
      risk += 0.28;
      reasons.push('low-value reply');
    }
    if ((options.highValueScore ?? 1) < 0.55) {
      risk += 0.12;
      reasons.push('weak mention value');
    }
    if (text.length > 900) {
      risk += 0.12;
      reasons.push('reply too long');
    }
  }
  if (/(send|transfer|buy|sell|mint|deploy|claim|airdrop)\s+(@|\$|0x|\d)/i.test(text)) {
    risk += 0.45;
    reasons.push('action-command shaped text');
  }

  risk += Math.max(0, (options.policyRiskScore ?? 0) - 0.22) * 0.65;
  risk += Math.max(0, (options.creativeRiskScore ?? 0) - 0.5) * 0.35;
  risk += Math.max(0, (options.slopScore ?? 0) - 0.42) * 0.45;
  risk += Math.max(0, 0.48 - (options.voiceScore ?? 0.72)) * 0.4;

  if (/\b(for example|because|data|specific|here is|when you|the tradeoff)\b/i.test(text)) {
    risk -= 0.08;
  }
  if (options.autonomyMode === 'safe') risk += 0.04;
  if (options.autonomyMode === 'explore' && options.surface === 'post') risk -= 0.03;

  const score = Number(clamp(risk).toFixed(3));
  const provocationScore = Number(clamp(provocation).toFixed(3));
  const blockThreshold = options.surface === 'reply' ? 0.58 : 0.68;
  const reviewThreshold = options.surface === 'reply' ? 0.42 : 0.5;
  const action = score >= blockThreshold ? 'block' : score >= reviewThreshold ? 'review' : 'allow';

  if (action !== 'allow' && reasons.length === 0) {
    reasons.push('taste risk exceeded autopilot threshold');
  }

  return {
    score,
    provocationScore,
    action,
    embarrassing: action === 'block',
    reasons,
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
  const replyShare = entry.replies / Math.max(1, entry.likes + entry.retweets + entry.replies);
  const highQualityReplyReward = clamp((entry.replies / Math.max(2, baselineLikes * 0.25)) * 0.16 + replyShare * 0.16, 0, 0.34);
  const relationshipReward = clamp(
    (entry.relationshipTargetHandle ? 0.12 : 0)
    + (entry.portfolioRole === 'relationship' ? 0.08 : 0)
    + (entry.networkCluster && entry.networkCluster !== 'generalists' ? 0.04 : 0),
    0,
    0.26,
  );
  const targetAudienceReward = clamp(
    (entry.targetAudienceSegment && entry.targetAudienceSegment !== 'generalists' ? 0.08 : 0)
    + Math.min(0.16, (entry.retweets + entry.replies) / Math.max(4, baselineLikes)),
    0,
    0.26,
  );
  const bookmarkProxyReward = clamp(
    (entry.impressions > 0 ? Math.log10(entry.impressions + 1) / 18 : 0)
    + Math.max(0, entry.engagementRate - 2) / 60,
    0,
    0.24,
  );
  const cringeRiskPenalty = clamp(
    (entry.slopScore || 0) * 0.14
    + (entry.creativeRiskScore || 0) * 0.12
    + (!entry.wasViral && entry.likes <= Math.max(1, baselineLikes * 0.35) ? 0.08 : 0),
    0,
    0.32,
  );
  const negativeFeedbackRisk = entry.wasViral ? 0 : clamp((entry.creativeRiskScore || 0) * 0.12 + (entry.slopScore || 0) * 0.08, 0, 0.18);
  const qualityAdjustedGrowthReward = clamp(
    (likeReward * 0.62)
    + (repostReward * 0.9)
    + highQualityReplyReward
    + relationshipReward
    + targetAudienceReward
    + bookmarkProxyReward
    + (engagementRateReward * 0.72)
    - cringeRiskPenalty
    - (negativeFeedbackRisk * 0.6),
    -0.6,
    0.9,
  );
  const qualityAdjustedGrowthScore = Math.round(clamp((qualityAdjustedGrowthReward + 0.6) / 1.5) * 100);
  const total = clamp(
    (likeReward + replyReward + repostReward + impressionReward + engagementRateReward + profileClickReward + followReward - negativeFeedbackRisk) * 0.45
    + qualityAdjustedGrowthReward * 0.55,
    -0.6,
    0.9,
  );

  return {
    likeReward: Number(likeReward.toFixed(3)),
    replyReward: Number(replyReward.toFixed(3)),
    repostReward: Number(repostReward.toFixed(3)),
    impressionReward: Number(impressionReward.toFixed(3)),
    engagementRateReward: Number(engagementRateReward.toFixed(3)),
    profileClickReward,
    followReward,
    highQualityReplyReward: Number(highQualityReplyReward.toFixed(3)),
    relationshipReward: Number(relationshipReward.toFixed(3)),
    targetAudienceReward: Number(targetAudienceReward.toFixed(3)),
    bookmarkProxyReward: Number(bookmarkProxyReward.toFixed(3)),
    cringeRiskPenalty: Number(cringeRiskPenalty.toFixed(3)),
    qualityAdjustedGrowthScore,
    qualityAdjustedGrowthReward: Number(qualityAdjustedGrowthReward.toFixed(3)),
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
