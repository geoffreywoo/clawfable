/**
 * Viral content generator powered by the configured AI provider.
 * Optimized for standalone posts, with supervised Engage handling live-network piggybacking.
 */

import { generateText } from './ai';
import type { AccountAnalysis, AgentLearnings, AudienceSegment, CreativeLane, ContentSourceLane, ContentStyleMode, IdeaAtom, MediaExperimentType, PersonalizationMemory, PostPortfolioRole, PromptStrategy, StyleSignals, Tweet } from './types';
import type { VoiceProfile } from './soul-parser';
import type { TrendingTopic } from './trending';
import { buildBanditSlotPlan, type BanditPolicy } from './bandit';
import { rankGeneratedTweets, selectTopRankedTweets, type RankedProtocolTweet } from './candidate-ranking';
import { judgeCandidates, mutateTopCandidates } from './generation-judging';
import { inferAudienceSegment } from './virality-signals';
import { getGeneratedTweetIssue, isNearDuplicate } from './survivability';
import { buildSourcePlannerPlan, type SourcePlannerPlan } from './source-planner';
import { buildShitpoastSlotSet, getShitpoastSlotCount, normalizeContentStyleMode, SHITPOAST_STYLE_MODE, STANDARD_STYLE_MODE } from './style-mode';
import { CLAWFABLE_PLATFORM_GOAL } from './platform-goal';
import {
  buildMediaBrief,
  buildPostPortfolioPlan,
  inferMediaExperimentType,
  inferPortfolioRole,
  MEDIA_SEQUENCE,
  normalizeMediaExperimentType,
  normalizePortfolioRole,
  PORTFOLIO_SEQUENCE,
} from './growth-engine';

const DEFAULT_STYLE_SIGNALS: StyleSignals = {
  sentenceLength: 'mixed',
  vocabulary: 'mixed',
  toneMarkers: [],
  topicPreferences: [],
  rawExtraction: '',
};

export interface ContentStyleConfig {
  lengthMix: { short: number; medium: number; long: number };
  enabledFormats: string[];
  autonomyMode: 'safe' | 'balanced' | 'explore';
  trendMixTarget: number;
  trendTolerance: 'adjacent' | 'moderate' | 'aggressive';
  shitpoastEnabled: boolean;
  exploration: {
    rate: number;
    underusedFormats: string[];
    underusedTopics: string[];
  };
  bias: {
    scheduledTopic: string | null;
    momentumTopic: string | null;
  };
  banditPolicy?: BanditPolicy | null;
  sourcePlan?: SourcePlannerPlan | null;
  mediaExperimentRate?: number;
  portfolioOptimizerEnabled?: boolean;
  relationshipQueueEnabled?: boolean;
}

const DEFAULT_STYLE: ContentStyleConfig = {
  lengthMix: { short: 30, medium: 30, long: 40 },
  enabledFormats: [],
  autonomyMode: 'balanced',
  trendMixTarget: 35,
  trendTolerance: 'moderate',
  shitpoastEnabled: false,
  exploration: {
    rate: 35,
    underusedFormats: [],
    underusedTopics: [],
  },
  bias: {
    scheduledTopic: null,
    momentumTopic: null,
  },
  banditPolicy: null,
  mediaExperimentRate: 15,
  portfolioOptimizerEnabled: true,
  relationshipQueueEnabled: true,
};

export const ALL_FORMATS = [
  'hot_take', 'question', 'data_point', 'short_punch', 'long_form', 'analysis', 'observation',
];

export interface ProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
  sourceLane?: ContentSourceLane | null;
  styleMode?: ContentStyleMode | null;
  creativeLane?: CreativeLane | null;
  draftExperimentId?: string | null;
  experimentBatchId?: string | null;
  experimentHypothesis?: string | null;
  experimentHoldout?: boolean | null;
  promptVariant?: string | null;
  targetAudienceSegment?: AudienceSegment | null;
  segmentHypothesis?: string | null;
  promptStrategy?: PromptStrategy | null;
  mediaExperimentType?: MediaExperimentType | null;
  mediaBrief?: string | null;
  portfolioRole?: PostPortfolioRole | null;
  relationshipTargetHandle?: string | null;
  trendFitScore?: number | null;
  trendTopicId?: string | null;
  trendHeadline?: string | null;
}

const CREATIVE_LANES: CreativeLane[] = [
  'operator_take',
  'contrarian_angle',
  'story_example',
  'teaching_threadlet',
  'weird_memetic',
  'trend_riff',
];

const CREATIVE_LANE_GUIDANCE: Record<CreativeLane, string> = {
  operator_take: 'Native account take. Sounds closest to the strongest manual posts and should clear review with minimal edits.',
  contrarian_angle: 'Specific disagreement with the default market narrative. Strong claim, but still credible.',
  story_example: 'A concrete mini-story, example, or observed pattern that makes the idea feel lived-in.',
  teaching_threadlet: 'Compact educational breakdown. Useful without becoming generic advice content.',
  weird_memetic: 'Sharper, more surprising, more memorable phrasing. Strange-but-true, not random.',
  trend_riff: 'Riffs on a live topic through the account’s actual worldview instead of summarizing the trend.',
};

const PORTFOLIO_ROLE_GUIDANCE: Record<PostPortfolioRole, string> = {
  proof: 'A concrete proof/data/operator evidence post. Makes a claim feel earned.',
  contrarian: 'A disagreement with a popular belief. Specific, defensible, and likely to spread.',
  story: 'A mini-story or observed example. Makes the account feel lived-in and memorable.',
  reply_bait: 'A substantive question or tension that invites high-quality replies without cheap bait.',
  trend: 'A timely take on an accepted trend through the account worldview.',
  media: 'A post whose idea becomes stronger with an image, screenshot, meme, or short video.',
  relationship: 'A post designed to build ties with a specific audience cluster or account type.',
};

const MEDIA_EXPERIMENT_GUIDANCE: Record<MediaExperimentType, string> = {
  text_only: 'No media. The text must carry the whole post.',
  image: 'Needs one clean visual concept that makes the point concrete.',
  video: 'Needs a short clip/demo/talking-head concept with one clear beat.',
  screenshot: 'Needs a screenshot/table/chart/dashboard-style proof artifact.',
  meme: 'Needs a simple native meme concept that sharpens the point without reducing substance.',
};

function normalizeCreativeLane(value: unknown): CreativeLane {
  return CREATIVE_LANES.includes(value as CreativeLane) ? value as CreativeLane : 'operator_take';
}

function normalizeAudienceSegment(value: unknown, content: string, topic: string): AudienceSegment {
  const allowed: AudienceSegment[] = [
    'founders',
    'ai_builders',
    'biohackers',
    'investors',
    'creator_operators',
    'technical_operators',
    'reply_regulars',
    'generalists',
  ];
  return allowed.includes(value as AudienceSegment)
    ? value as AudienceSegment
    : inferAudienceSegment(content, topic);
}

function buildCreativeLanePlan(count: number, sourcePlan: SourcePlannerPlan, shitpoastEnabled: boolean): Map<number, CreativeLane> {
  const lanes = new Map<number, CreativeLane>();
  const baseSequence: CreativeLane[] = [
    'operator_take',
    'contrarian_angle',
    'story_example',
    'teaching_threadlet',
    'operator_take',
    'weird_memetic',
  ];

  for (let slot = 1; slot <= count; slot++) {
    const sourceSlot = sourcePlan.slots[slot - 1] || null;
    let lane = baseSequence[(slot - 1) % baseSequence.length];
    if (sourceSlot?.sourceLane === 'trend_aligned_exploit' || sourceSlot?.sourceLane === 'trend_adjacent_explore') {
      lane = 'trend_riff';
    }
    if (shitpoastEnabled && slot % 5 === 0) {
      lane = 'weird_memetic';
    }
    lanes.set(slot, lane);
  }

  return lanes;
}

function normalizeTopicLabel(topic: string): string {
  return topic.trim().replace(/[_-]+/g, ' ');
}

function buildFallbackClaim(topic: string, tone: string): string {
  const normalizedTone = tone.toLowerCase();

  if (normalizedTone.includes('contrarian')) {
    return `${topic} is still being framed around the wrong bottleneck.`;
  }
  if (normalizedTone.includes('optimist')) {
    return `The upside in ${topic} is bigger than most people realize.`;
  }
  if (normalizedTone.includes('analyst')) {
    return `The market is misreading what actually compounds in ${topic}.`;
  }
  if (normalizedTone.includes('provocateur')) {
    return `Most of the ${topic} conversation is theater, not edge.`;
  }
  if (normalizedTone.includes('educator')) {
    return `If you want to understand ${topic}, start with the incentives.`;
  }

  return `${topic} is changing faster than the default playbook assumes.`;
}

function buildFallbackAngle(tone: string): string {
  const normalizedTone = tone.toLowerCase();

  if (normalizedTone.includes('contrarian') || normalizedTone.includes('provocateur')) {
    return 'The compounding advantage is learning faster than the people still optimizing the packaging';
  }
  if (normalizedTone.includes('optimist')) {
    return 'The upside goes to people who can turn feedback into product velocity';
  }
  if (normalizedTone.includes('analyst')) {
    return 'The useful question is who learns faster once the feedback loop tightens';
  }
  if (normalizedTone.includes('educator')) {
    return 'The clean way to see it is to separate reach from actual learning rate';
  }

  return 'The edge is not sounding louder, it is learning faster';
}

function buildFallbackTemplates(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  count: number,
  style: ContentStyleConfig,
  recentPosts: string[],
): ProtocolTweet[] {
  const topics = Array.from(new Set([
    ...(style.bias.momentumTopic ? [style.bias.momentumTopic] : []),
    ...(style.bias.scheduledTopic ? [style.bias.scheduledTopic] : []),
    ...analysis.engagementPatterns.topTopics,
    ...voiceProfile.topics,
    'AI',
  ]))
    .filter(Boolean)
    .map(normalizeTopicLabel)
    .slice(0, 6);

  const enabledFormats = style.enabledFormats.length > 0 ? style.enabledFormats : ALL_FORMATS;
  const formats = enabledFormats.length > 0 ? enabledFormats : ['hot_take', 'analysis', 'observation', 'question'];
  const maxTemplates = Math.max(count * 2, count + 3);
  const templates: ProtocolTweet[] = [];
  const contentSeen = new Set<string>();
  const recentCorpus = recentPosts.map((post) => post.toLowerCase());

  const addTemplate = (tweet: ProtocolTweet) => {
    const normalized = tweet.content.trim();
    if (!normalized || contentSeen.has(normalized)) return;
    if (recentCorpus.some((post) => post.includes(normalized.toLowerCase()))) return;
    contentSeen.add(normalized);
    templates.push(tweet);
  };

  for (const topic of topics) {
    const claim = buildFallbackClaim(topic, voiceProfile.tone);
    const angle = buildFallbackAngle(voiceProfile.tone);

    for (const format of formats) {
      if (templates.length >= maxTemplates) break;

      switch (format) {
        case 'hot_take':
          addTemplate({
            content: `${claim}\n\nThe winners will be the people who optimize for signal, not optics.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: contrarian claim with a clean operator takeaway.',
          });
          break;
        case 'analysis':
          addTemplate({
            content: `The mistake people keep making with ${topic} is assuming distribution is the moat.\n\nThe real edge is tighter feedback loops, faster iteration, and clearer taste.\n\n${angle}.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: structured analysis aligned to the account voice.',
          });
          break;
        case 'observation':
          addTemplate({
            content: `Observation:\n\nmost people talking about ${topic} are optimizing for narrative.\n\nthe operators are optimizing for compounding advantages.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: short observational frame built for reply and bookmark energy.',
          });
          break;
        case 'question':
          addTemplate({
            content: `Serious question:\n\nwhat does ${topic} look like when you remove the legacy assumption everyone is still building around?`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: question-led prompt designed to trigger thoughtful replies.',
          });
          break;
        case 'data_point':
          addTemplate({
            content: `Data point:\n\nwhen a market shifts from rewarding hype to rewarding iteration speed, almost every incumbent reads the change too late.\n\n${topic} looks a lot like that right now.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: pseudo-data framing without inventing fake numbers.',
          });
          break;
        case 'short_punch':
          addTemplate({
            content: `${topic} rewards builders.\n\nnot narrators.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: short punchy contrast for fast engagement.',
          });
          break;
        case 'long_form':
          addTemplate({
            content: `The common mistake in ${topic} discourse is confusing visibility with leverage.\n\nVisibility gets attention.\nLeverage compounds outcomes.\n\nThe people winning this cycle are the ones building systems that learn faster than their competitors.\n\nThat is the real moat.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: longer structured argument for depth-oriented readers.',
          });
          break;
        default:
          addTemplate({
            content: `${claim}\n\nThat is the shift most people are still underestimating.`,
            format,
            targetTopic: topic,
            rationale: 'Template fallback: generic resilient format when richer generation is unavailable.',
          });
          break;
      }
    }
  }

  return templates.slice(0, maxTemplates);
}

function shouldUseFallbackGeneration(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('credit balance is too low')
    || message.includes('plans & billing')
    || message.includes('insufficient_quota')
    || message.includes('exceeded your current quota')
    || message.includes('billing hard limit')
    || message.includes('api key quota')
    || message.includes('overloaded')
    || message.includes('temporarily unavailable')
    || message.includes('rate limit')
    || message.includes('tokens per min')
    || message.includes('api connection')
    || message.includes('request failed')
  );
}

/**
 * Collect quotable tweets from trending topics — high-engagement posts
 * from the agent's network that are worth QTing.
 */
function collectQuotableTweets(trending: TrendingTopic[]): Array<{
  id: string;
  text: string;
  author: string;
  likes: number;
  category: string;
}> {
  const quotable: Array<{ id: string; text: string; author: string; likes: number; category: string }> = [];

  for (const topic of trending) {
    if (topic.topTweet && topic.topTweet.id) {
      quotable.push({
        id: topic.topTweet.id,
        text: topic.topTweet.text,
        author: topic.topTweet.author,
        likes: topic.topTweet.likes,
        category: topic.category,
      });
    }
  }

  // Sort by engagement — most quotable first
  quotable.sort((a, b) => b.likes - a.likes);
  return quotable.slice(0, 12);
}

/**
 * Build the system prompt for the configured AI provider.
 */
function buildSystemPrompt(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  finalCount: number,
  candidateCount: number,
  trending: TrendingTopic[] | null,
  learnings: AgentLearnings | null,
  soulMd: string | null,
  style: ContentStyleConfig = DEFAULT_STYLE,
  recentPosts: string[] = [],
  memory: PersonalizationMemory | null = null,
): string {
  const parts: string[] = [];

  parts.push(`You are a tweet ghostwriter for a Twitter account. Write original tweets that sound exactly like this person and drive maximum engagement (likes, replies, retweets).`);
  parts.push(`\n## CLAWFABLE PLATFORM GOAL (NON-NEGOTIABLE)
${CLAWFABLE_PLATFORM_GOAL}

Every draft must preserve the account's authentic voice while increasing its odds of niche attention, conversation, and virality.`);

  // Time-of-day awareness: match content tone to audience mood
  const hour = new Date().getUTCHours();
  const timeSlot =
    (hour >= 13 && hour <= 18) ? 'morning-US' :  // 5am-10am PT
    (hour >= 18 && hour <= 22) ? 'midday-US' :    // 10am-2pm PT
    (hour >= 22 || hour <= 2) ? 'afternoon-US' :   // 2pm-6pm PT
    (hour >= 2 && hour <= 6) ? 'evening-US' :      // 6pm-10pm PT
    'late-night';                                    // 10pm-5am PT

  const timeGuidance: Record<string, string> = {
    'morning-US': 'Morning audience: professionals scrolling before work. Lead with sharp insights, data-driven takes, and professional observations. Set the agenda for the day.',
    'midday-US': 'Midday audience: people on lunch breaks and between meetings. Hot takes, quick opinions, and reaction-worthy content. Higher energy, more provocative.',
    'afternoon-US': 'Afternoon audience: winding down, looking for interesting discussions. Longer-form analysis, thoughtful threads, and engaging questions that spark debate.',
    'evening-US': 'Evening audience: casual browsing, relaxed mood. Personal observations, humor, behind-the-scenes, lighter takes. More conversational tone.',
    'late-night': 'Late-night audience: degen hours. Unfiltered takes, shitposts, bold predictions, contrarian views. The most engaged niche audience.',
  };

  parts.push(`\n## TIME CONTEXT: ${timeGuidance[timeSlot] || timeGuidance['midday-US']}`);

  // Include the full SOUL.md — this is the most important context for voice
  if (soulMd) {
    parts.push(`\n## SOUL.md (THIS IS THE CORE IDENTITY — every tweet must sound like this person)
${soulMd}`);
  }

  parts.push(`\n## VOICE PROFILE (extracted from SOUL.md)
- Tone: ${voiceProfile.tone}
- Topics: ${voiceProfile.topics.join(', ')}
- Communication style: ${voiceProfile.communicationStyle}
- Anti-goals (never do these): ${voiceProfile.antiGoals.join('; ') || 'none specified'}
- Creator: Geoffrey Woo (@geoffreywoo) — your human creator who built you`);

  const ep = analysis.engagementPatterns;
  parts.push(`\n## ENGAGEMENT DATA
- Average likes: ${ep.avgLikes}, Average RTs: ${ep.avgRetweets}
- Viral threshold (3x avg): ${ep.viralThreshold}+ likes
- Top performing formats: ${ep.topFormats.join(', ') || 'unknown'}
- Best topics by engagement: ${ep.topTopics.join(', ') || 'unknown'}
- Peak posting hours (UTC): ${ep.topHours.join(', ') || 'unknown'}
- Content fingerprint: ${analysis.contentFingerprint}`);

  if (analysis.viralTweets.length > 0) {
    parts.push(`\n## THIS ACCOUNT'S TOP POSTS (study the style, length, and tone — match it)`);
    for (const vt of analysis.viralTweets.slice(0, 5)) {
      parts.push(`- [${vt.likes} likes, ${vt.retweets} RTs] "${vt.text}"`);
    }
  }

  if (analysis.followingProfile.categories.length > 0) {
    parts.push(`\n## AUDIENCE CONTEXT`);
    for (const cat of analysis.followingProfile.categories.slice(0, 5)) {
      parts.push(`- ${cat.label}: ${cat.count} accounts (e.g. ${cat.handles?.slice(0, 3).map(h => '@' + h).join(', ') || 'various'})`);
    }
  }

  // Trending context + viral tweet styles to study
  if (trending && trending.length > 0) {
    parts.push(`\n## WHAT'S TRENDING RIGHT NOW (ride these waves — timely content outperforms generic takes)`);
    for (const t of trending.slice(0, 8)) {
      parts.push(`\n### [${t.category}] ${t.headline}`);
      parts.push(`Source: ${t.source} · ${t.tweetCount} posts in network`);
      if (t.topTweet) {
        parts.push(`VIRAL TWEET (${t.topTweet.likes} likes by @${t.topTweet.author}):`);
        parts.push(`"${t.topTweet.text.slice(0, 300)}"`);
        parts.push(`^ Study this tweet's style, hook, and angle. Write something that rides the same wave but adds YOUR unique perspective.`);
      }
    }
    parts.push(`\nIMPORTANT: At least 30-50% of your tweets should reference or riff on these trending topics. Don't just acknowledge the topic — add a take that makes people engage.`);
  }

  // Learnings from actual performance of our generated tweets
  if (learnings && learnings.totalTracked > 0) {
    const breakdown = learnings.sourceBreakdown;
    const trainingSourceLabel = breakdown?.trainingSource === 'autopilot' ? 'autopilot' : 'training-set';
    parts.push(`\n## LEARNINGS FROM ACCOUNT PERFORMANCE (THIS IS CRITICAL — adapt based on what actually works)`);
    parts.push(`Tracked ${learnings.totalTracked} tweets total. Avg ${learnings.avgLikes} likes, ${learnings.avgRetweets} RTs.`);
    if (breakdown) {
      if (breakdown.manual > 0) {
        parts.push(`Manually posted tweets are HIGH-SIGNAL operator approvals. Prioritize those ${breakdown.manual} manual posts when matching voice, sentiment, tone, cadence, topic boundaries, and structure. Autopilot data should tune performance only when it agrees with the manual signal.`);
      } else if (breakdown.trainingSource === 'autopilot') {
        parts.push(`Autonomous policy should trust the ${breakdown.trainingCount} autopilot tweets below first. Human reference pool: ${breakdown.manual + breakdown.timeline} timeline/manual tweets for comparison only.`);
      } else {
        parts.push(`Autopilot history is still sparse, so the current training set mixes autopilot and operator-written tweets. Treat strong operator examples as high-signal voice, sentiment, tone, and topic references.`);
      }
    }

    if (learnings.formatRankings.length > 0) {
      parts.push(`\nFormat performance (${trainingSourceLabel} tweets):`);
      for (const f of learnings.formatRankings.slice(0, 5)) {
        parts.push(`- ${f.format}: avg ${f.avgEngagement} engagement (${f.count} tweets)`);
      }
    }

    if (learnings.topicRankings.length > 0) {
      parts.push(`\nTopic performance (${trainingSourceLabel} tweets):`);
      for (const t of learnings.topicRankings.slice(0, 5)) {
        parts.push(`- ${t.topic}: avg ${t.avgEngagement} engagement (${t.count} tweets)`);
      }
    }

    if (learnings.bestPerformers.length > 0) {
      parts.push(`\nBEST ${trainingSourceLabel.toUpperCase()} tweets (do MORE like these):`);
      for (const t of learnings.bestPerformers.slice(0, 3)) {
        parts.push(`- [${t.likes} likes] "${t.content.slice(0, 150)}"`);
      }
    }

    if (learnings.worstPerformers.length > 0) {
      parts.push(`\nWORST ${trainingSourceLabel.toUpperCase()} tweets (do LESS like these):`);
      for (const t of learnings.worstPerformers.slice(0, 3)) {
        parts.push(`- [${t.likes} likes] "${t.content.slice(0, 150)}"`);
      }
    }

    if (learnings.insights.length > 0) {
      parts.push(`\nPRESCRIPTIVE RULES (follow these — they are derived from real performance data):`);
      for (const insight of learnings.insights) {
        parts.push(`- ${insight}`);
      }
    }

    // Style fingerprint — computed from top 30 performing tweets
    if (learnings.styleFingerprint) {
      const fp = learnings.styleFingerprint;
      parts.push(`\n## STYLE FINGERPRINT (how the BEST tweets are written — match this)`);
      parts.push(`- Sweet spot length: ${fp.avgLength} chars (${fp.shortPct}% short, ${fp.mediumPct}% medium, ${fp.longPct}% long)`);
      if (fp.questionRatio > 20) parts.push(`- ${fp.questionRatio}% of top tweets ask questions — include questions`);
      if (fp.usesNumbers) parts.push(`- Top tweets use specific numbers and data — be data-driven`);
      if (fp.usesLineBreaks) parts.push(`- Top tweets use line breaks for structure — use \\n`);
      if (!fp.usesEmojis) parts.push(`- Top tweets do NOT use emojis — avoid them`);
      if (fp.topHooks.length > 0) parts.push(`- Best opening hooks: ${fp.topHooks.join(', ')}`);
      if (fp.topTones.length > 0) parts.push(`- Best-performing tones: ${fp.topTones.join(', ')}`);
      if (fp.antiPatterns.length > 0) {
        parts.push(`\n## HARD BLOCKLIST (violating these WILL produce low-engagement content — derived from your worst-performing tweets):`);
        for (const ap of fp.antiPatterns) {
          parts.push(`- ${ap}`);
        }
        parts.push(`These are not suggestions. They are patterns that have been PROVEN to fail for this account. Do not use them under any circumstances.`);
      }
    }

    if (learnings.operatorVoiceReference && learnings.operatorVoiceReference.bestPerformers.length > 0) {
      const humanRef = learnings.operatorVoiceReference;
      const fp = humanRef.styleFingerprint;
      parts.push(`\n## MANUAL / OPERATOR VOICE ANCHORS (high-signal examples — copy the voice, sentiment, tone, and cadence, not the exact take)`);
      parts.push(`Derived from ${humanRef.sampleCount} manually posted or operator-written tweets.`);
      parts.push(`- Human sweet spot length: ${fp.avgLength} chars (${fp.shortPct}% short, ${fp.mediumPct}% medium, ${fp.longPct}% long)`);
      if (fp.usesLineBreaks) parts.push(`- Strong human-written posts use line breaks for pacing`);
      if (!fp.usesEmojis) parts.push(`- Strong human-written posts avoid emojis`);
      if (fp.topHooks.length > 0) parts.push(`- Human-preferred hooks: ${fp.topHooks.join(', ')}`);
      if (fp.topTones.length > 0) parts.push(`- Human-preferred tones: ${fp.topTones.join(', ')}`);
      for (const t of humanRef.bestPerformers.slice(0, 3)) {
        parts.push(`- HIGH-SIGNAL MANUAL VOICE EXAMPLE [${t.likes} likes, source:${t.source}]: "${t.content.slice(0, 180)}"`);
      }
    }

    if (learnings.manualTopicProfile && learnings.manualTopicProfile.length > 0) {
      parts.push(`\n## MANUAL TOPIC PRIORS (topics and angles proven in human-written tweets)`);
      for (const cluster of learnings.manualTopicProfile.slice(0, 6)) {
        parts.push(`- ${cluster.topic}: "${cluster.angle}" (${cluster.sampleCount} examples, avg ${cluster.avgEngagement} engagement)`);
      }
    }
  }

  // Recent posts — avoid repeating
  if (recentPosts.length > 0) {
    parts.push(`\n## RECENTLY POSTED (DO NOT repeat these topics, angles, or phrasing — be FRESH)`);
    for (const post of recentPosts.slice(0, 15)) {
      parts.push(`- "${post.slice(0, 150)}"`);
    }
  }

  // Dynamic strategy based on user config
  const { lengthMix, enabledFormats } = style;
  const explorationRate = Math.max(0, Math.min(100, style.exploration.rate ?? DEFAULT_STYLE.exploration.rate));
  const explorationCount = finalCount >= 4 ? Math.max(1, Math.round((finalCount * explorationRate) / 100)) : 0;
  const formats = enabledFormats.length > 0 ? enabledFormats : ALL_FORMATS;
  const sourcePlan = style.sourcePlan || buildSourcePlannerPlan({
    count: finalCount,
    autonomyMode: style.autonomyMode,
    trendMixTarget: style.trendMixTarget,
    trendTolerance: style.trendTolerance,
    voiceProfile,
    learnings,
    trending,
    fallbackTopics: style.exploration.underusedTopics,
  });
  const slotPlan = buildBanditSlotPlan(style.banditPolicy, {
    count: finalCount,
    explorationRate,
    biasTopics: [style.bias.momentumTopic, style.bias.scheduledTopic].filter(Boolean) as string[],
    sourcePlan,
    shitpoastEnabled: style.shitpoastEnabled,
  });
  const shitpoastSlots = slotPlan.filter((plan) => plan.styleMode === SHITPOAST_STYLE_MODE).length;

  if (memory) {
    if (memory.alwaysDoMoreOfThis.length > 0) {
      parts.push(`\n## PERSONALIZATION: DO MORE OF THIS\n${memory.alwaysDoMoreOfThis.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.neverDoThisAgain.length > 0) {
      parts.push(`\n## PERSONALIZATION: AVOID THIS\n${memory.neverDoThisAgain.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.operatorHiddenPreferences.length > 0) {
      parts.push(`\n## OPERATOR PREFERENCES (inferred from edits/remixes)\n${memory.operatorHiddenPreferences.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.editTransformations.length > 0) {
      parts.push(`\n## EDIT TRANSFORMATION MEMORY\nGenerate closer to the approved after-state from these operator edits:\n${memory.editTransformations.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.referenceBank?.length) {
      parts.push(`\n## REFERENCE BANK (high-performing examples to study, not copy)\n${memory.referenceBank.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.conversationInsights?.length) {
      parts.push(`\n## CONVERSATION INSIGHTS\nUse these when a post can invite substantive replies without becoming cheap engagement bait:\n${memory.conversationInsights.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.audienceSegmentLessons?.length) {
      parts.push(`\n## AUDIENCE SEGMENT LESSONS\n${memory.audienceSegmentLessons.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.promptStrategyLessons?.length) {
      parts.push(`\n## PROMPT STRATEGY LESSONS\n${memory.promptStrategyLessons.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.portfolioLessons?.length) {
      parts.push(`\n## POST PORTFOLIO LESSONS\n${memory.portfolioLessons.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.mediaExperimentLessons?.length) {
      parts.push(`\n## MEDIA EXPERIMENT LESSONS\n${memory.mediaExperimentLessons.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.networkClusterLessons?.length) {
      parts.push(`\n## NETWORK CLUSTER LESSONS\n${memory.networkClusterLessons.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.relationshipLessons?.length) {
      parts.push(`\n## RELATIONSHIP LESSONS\n${memory.relationshipLessons.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.viralityPostmortems?.length) {
      parts.push(`\n## VIRALITY POSTMORTEMS\n${memory.viralityPostmortems.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.replyMiningInsights?.length) {
      parts.push(`\n## REPLY-MINED IDEAS\n${memory.replyMiningInsights.map((item) => `- ${item}`).join('\n')}`);
    }
  }

  if (style.bias.scheduledTopic || style.bias.momentumTopic) {
    parts.push(`\n## ACTIVE TOPIC BIAS`);
    if (style.bias.scheduledTopic) {
      parts.push(`- Today's scheduled focus: ${style.bias.scheduledTopic}`);
    }
    if (style.bias.momentumTopic) {
      parts.push(`- Momentum topic from recent engagement: ${style.bias.momentumTopic}`);
    }
    parts.push(`Use these as fuel for 1-2 tweets if they fit the voice, but do not repeat the same angle across the batch.`);
  }

  if (explorationCount > 0) {
    const underusedFormats = style.exploration.underusedFormats.slice(0, 4).join(', ') || 'any format that has not been used recently';
    const underusedTopics = style.exploration.underusedTopics.slice(0, 4).join(', ') || 'stale core topics that deserve another pass';
    parts.push(`\n## EXPLORATION BUDGET
- ${explorationCount} of the ${finalCount} tweets in this batch must be deliberate experiments so the account learns faster.
- Keep those experiments on-brand, but push into fresher territory instead of rewriting the same take.
- Prefer these underused formats first: ${underusedFormats}
- Prefer these underused or stale core topics next: ${underusedTopics}
- If those are exhausted, test adjacent topics one step away from the core voice. Not random. Not off-brand.
- Never spend the whole batch exploring. The rest should exploit proven winners.`);
  }

  if (sourcePlan.acceptedTrends.length > 0 || sourcePlan.rejectedTrends.length > 0) {
    parts.push(`\n## SOURCE-AWARE PLANNER
- Target trend mix: ${style.trendMixTarget}% of the batch
- Trend tolerance: ${style.trendTolerance}
- Accepted trend lanes: ${sourcePlan.acceptedTrends.slice(0, 5).map((trend) => `${trend.category} (${trend.sourceLane})`).join(', ') || 'none'}
- Rejected trend classes: ${sourcePlan.rejectedTrends.slice(0, 4).map((trend) => trend.category).join(', ') || 'none'}`);
  }

  if (style.banditPolicy && slotPlan.length > 0) {
    parts.push(`\n## BANDIT SLOT PLAN (follow this exactly)
This batch is allocated by a multi-armed bandit controller. Each slot is an actual traffic bet, not a suggestion.`);
    for (const plan of slotPlan) {
      parts.push(`- Slot ${plan.slot}: ${plan.mode.toUpperCase()} | lane=${plan.sourceLane} | style=${plan.styleMode} | format=${plan.format} | topic=${plan.topic} | length=${plan.length} | hook=${plan.hook} | tone=${plan.tone} | specificity=${plan.specificity} | structure=${plan.structure}${plan.trendHeadline ? ` | trend="${plan.trendHeadline.slice(0, 80)}"` : ''} | ${plan.rationale}`);
    }
  }

  parts.push(`\n## CREATIVE LANES
Each candidate must choose exactly one creative lane. Lanes make the batch a portfolio instead of a pile of similar drafts:
${CREATIVE_LANES.map((lane) => `- ${lane}: ${CREATIVE_LANE_GUIDANCE[lane]}`).join('\n')}`);

  parts.push(`\n## POST PORTFOLIO ROLES
Each candidate must choose exactly one portfolio role. The batch should diversify why a post can spread:
${Object.entries(PORTFOLIO_ROLE_GUIDANCE).map(([role, guidance]) => `- ${role}: ${guidance}`).join('\n')}`);

  parts.push(`\n## MEDIA EXPERIMENTS
Use media only when it genuinely makes the idea more shareable or legible. If a slot asks for media, include a short mediaBrief:
${Object.entries(MEDIA_EXPERIMENT_GUIDANCE).map(([type, guidance]) => `- ${type}: ${guidance}`).join('\n')}`);

  if (style.shitpoastEnabled) {
    parts.push(`\n## SHITPOAST MODE
- Status: ON, capped at ${Math.round(0.2 * 100)}% of final slots${shitpoastSlots > 0 ? ` (${shitpoastSlots} planned slot${shitpoastSlots === 1 ? '' : 's'} in this batch)` : ''}.
- Only slots explicitly marked style=shitpoast should use this mode. All other slots stay standard.
- Shitpoast means sharper, weirder, more memetic, more surprising, and more unhinged in cadence.
- Keep it grounded in the account's real beliefs and approved topics. Do not become random.
- Hard guardrails still apply: no slurs, no targeted harassment, no defamatory claims, no fabricated facts, no calls for harm, no policy-unsafe bait.
- Prefer punchy hooks, odd-but-true observations, clean absurdity, and high-specificity contrarian angles.`);
  }

  parts.push(`\n## AUTONOMY MODE
- Current operating mode: ${style.autonomyMode.toUpperCase()}
- SAFE means: tighter quality bar, low policy risk, fewer weird experiments.
- EXPLORE means: take more calculated novelty bets so the system learns faster.
- BALANCED means: split the difference.
- Regardless of mode, stay unmistakably in-voice.`);

  parts.push(`\n## STRATEGY
All tweets are original standalone posts. No quote tweets.

## LENGTH DISTRIBUTION (follow this closely)
- ~${lengthMix.short}% SHORT (under 200 chars): punchy one-liners, sharp observations
- ~${lengthMix.medium}% MEDIUM (200-500 chars): single-point arguments, hot takes with context
- ~${lengthMix.long}% LONG-FORM (500-2000+ chars): multi-paragraph analysis, structured breakdowns, storytelling, contrarian arguments with evidence
${lengthMix.long >= 30 ? 'Long-form posts should go DEEP — use line breaks, build arguments, provide insight that short tweets cannot. X Premium rewards depth.' : ''}
X supports up to 4000 chars. Use \\n for line breaks in longer posts.

## ALLOWED FORMATS
${formats.join(', ')}

## RULES
1. Write in this account's exact voice. Match the style of the top performing tweets.
2. No threads, no "1/", no emojis unless the account uses them.
3. Never use hashtags unless the account's viral tweets use them.
4. Never be generic. Every tweet needs a specific, opinionated point of view.
5. Never include links to x.com or twitter.com in tweet text.
6. Across a batch, vary format, hook, and target topic. Do not write near-duplicates or multiple tweets that make the same point.
7. Authority claims must earn trust: if a tweet uses broad certainty language like everyone, nobody, always, never, guaranteed, or says a market/group is wrong, it must include proof, a concrete example, a mechanism, a metric, or an observed failure mode.
8. Never violate the anti-goals.`);

  parts.push(`\nGenerate ${candidateCount} candidates so a downstream ranker can pick the strongest ${finalCount}. That means you should include a few ambitious bets, not just safe paraphrases.`);

  return parts.join('\n');
}

/**
 * Generate a batch of tweets using the configured AI provider, optimized for QTs.
 */
export async function generateViralBatch(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  count: number,
  trending: TrendingTopic[] | null = null,
  learnings: AgentLearnings | null = null,
  soulMd: string | null = null,
  style: ContentStyleConfig = DEFAULT_STYLE,
  recentPosts: string[] = [],
  allTweets: Tweet[] = [],
  memory: PersonalizationMemory | null = null,
  ideaAtoms: IdeaAtom[] = [],
): Promise<RankedProtocolTweet[]> {
  const candidateCount = count <= 1 ? 12 : count <= 3 ? 14 : count <= 5 ? 16 : Math.min(20, count + 10);
  const experimentBatchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sourcePlan = style.sourcePlan || buildSourcePlannerPlan({
    count: candidateCount,
    autonomyMode: style.autonomyMode,
    trendMixTarget: style.trendMixTarget,
    trendTolerance: style.trendTolerance,
    voiceProfile,
    learnings,
    trending,
    fallbackTopics: style.exploration.underusedTopics,
  });
  const effectiveStyle = {
    ...style,
    sourcePlan,
  };
  const systemPrompt = buildSystemPrompt(voiceProfile, analysis, count, candidateCount, trending, learnings, soulMd, effectiveStyle, recentPosts, memory);

  const formats = effectiveStyle.enabledFormats.length > 0 ? effectiveStyle.enabledFormats : ALL_FORMATS;
  const explorationRate = Math.max(0, Math.min(100, effectiveStyle.exploration.rate ?? DEFAULT_STYLE.exploration.rate));
  const explorationCount = count >= 4 ? Math.max(1, Math.round((count * explorationRate) / 100)) : 0;
  const slotPlan = buildBanditSlotPlan(effectiveStyle.banditPolicy, {
    count: candidateCount,
    explorationRate,
    biasTopics: [effectiveStyle.bias.momentumTopic, effectiveStyle.bias.scheduledTopic].filter(Boolean) as string[],
    sourcePlan,
    shitpoastEnabled: effectiveStyle.shitpoastEnabled,
  });
  const maxShitpoast = getShitpoastSlotCount(count, effectiveStyle.shitpoastEnabled);
  const inferredShitpoastSlots = buildShitpoastSlotSet(count, effectiveStyle.shitpoastEnabled);
  const creativeLanePlan = buildCreativeLanePlan(candidateCount, sourcePlan, effectiveStyle.shitpoastEnabled);
  const portfolioPlan = buildPostPortfolioPlan({
    count: candidateCount,
    settings: {
      portfolioOptimizerEnabled: effectiveStyle.portfolioOptimizerEnabled,
      mediaExperimentRate: effectiveStyle.mediaExperimentRate,
    },
    learnings,
  });
  const trendFitById = new Map(sourcePlan.acceptedTrends.map((trend) => [String(trend.id), trend.fitScores.total]));
  const creativeSlotGuide = Array.from({ length: candidateCount }, (_, index) => {
    const slot = index + 1;
    const lane = creativeLanePlan.get(slot) || 'operator_take';
    const plan = slotPlan.find((item) => item.slot === slot);
    const portfolioRole = portfolioPlan[index] || 'proof';
    const mediaType = inferMediaExperimentType({
      content: `${plan?.topic || ''} ${plan?.hook || ''} ${plan?.structure || ''}`,
      portfolioRole,
      slot,
      mediaExperimentRate: effectiveStyle.mediaExperimentRate ?? DEFAULT_STYLE.mediaExperimentRate,
    });
    return `- Slot ${slot}: creativeLane=${lane} | portfolioRole=${portfolioRole} | mediaExperimentType=${mediaType}${plan?.holdout ? ' | HOLDOUT=true' : ''}${plan ? ` | ${plan.mode} | ${plan.format}/${plan.topic}/${plan.hook}/${plan.structure}` : ''}`;
  }).join('\n');
  const userPrompt = `Generate exactly ${candidateCount} original standalone tweets. Follow the length distribution in the system prompt exactly. For each tweet, output a JSON object on its own line with these fields:
- "slot": the slot number you are fulfilling
- "content": the tweet text (any length up to 4000 chars — use \\n for line breaks in longer posts)
- "format": one of: ${formats.join(', ')}
- "targetTopic": what topic this tweet is about
- "styleMode": "standard" or "shitpoast" (must match the slot's style)
- "creativeLane": one of: ${CREATIVE_LANES.join(', ')}
- "portfolioRole": one of: ${PORTFOLIO_SEQUENCE.join(', ')}
- "mediaExperimentType": one of: ${MEDIA_SEQUENCE.join(', ')}
- "mediaBrief": short visual/media concept, or null for text_only
- "relationshipTargetHandle": optional handle only if this is aimed at a specific relationship target, else null
- "targetAudienceSegment": who this is mainly for (founders, ai_builders, biohackers, investors, creator_operators, technical_operators, reply_regulars, or generalists)
- "segmentHypothesis": one short sentence explaining why that audience should care
- "rationale": 1 sentence on why this should perform well

${explorationCount > 0 ? `At least ${explorationCount} tweets in this batch must be true exploration plays: fresher format, fresher topic, or a more surprising angle that still fits the account.` : ''}
${slotPlan.length > 0 ? `You must satisfy every bandit slot exactly once. Match the assigned source lane, styleMode, format, targetTopic, length, hook, tone, specificity, structure, and mode for each slot.` : ''}

Creative lane assignment:
${creativeSlotGuide}

Output ONLY JSON objects, one per line, no markdown fencing.`;

  try {
    const response = await generateText({
      task: 'tweet_generation',
      tier: 'quality',
      maxTokens: 4096,
      system: systemPrompt,
      prompt: userPrompt,
    });

    const text = response.text;

    const stagedTweets: Array<ProtocolTweet & { slot: number }> = [];
    const acceptedContents: string[] = [];
    const usedFormatTopicCombos = new Set<string>();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content && parsed.content.length > 0) {
          // Strip hallucinated x.com/twitter.com status URLs from content.
          // Standalone posts should not carry status links or quote-tweet URLs.
          const cleanContent = parsed.content
            .replace(/\s*https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\S*/gi, '')
            .trim();
          if (!cleanContent) continue;
          if (getGeneratedTweetIssue(cleanContent)) continue;
          const slot = Number(parsed.slot || 0);
          const format = parsed.format || 'hot_take';
          const targetTopic = parsed.targetTopic || 'general';
          const slotAssignment = slotPlan.find((plan) => plan.slot === slot) || null;
          const creativeLane = normalizeCreativeLane(parsed.creativeLane || creativeLanePlan.get(slot));
          const targetAudienceSegment = normalizeAudienceSegment(parsed.targetAudienceSegment, cleanContent, targetTopic);
          const parsedMediaType = normalizeMediaExperimentType(parsed.mediaExperimentType);
          const portfolioRole = normalizePortfolioRole(parsed.portfolioRole || portfolioPlan[Math.max(0, slot - 1)] || inferPortfolioRole({
            content: cleanContent,
            format,
            creativeLane,
            sourceLane: slotAssignment?.sourceLane || null,
            mediaExperimentType: parsedMediaType,
          }));
          const mediaExperimentType = parsed.mediaExperimentType
            ? parsedMediaType
            : inferMediaExperimentType({
                content: cleanContent,
                portfolioRole,
                slot,
                mediaExperimentRate: effectiveStyle.mediaExperimentRate ?? DEFAULT_STYLE.mediaExperimentRate,
              });
          const mediaBrief = mediaExperimentType === 'text_only'
            ? null
            : (
                typeof parsed.mediaBrief === 'string' && parsed.mediaBrief.trim()
                  ? parsed.mediaBrief.trim().slice(0, 260)
                  : buildMediaBrief({ content: cleanContent, topic: targetTopic, mediaExperimentType })
              );
          const relationshipTargetHandle = typeof parsed.relationshipTargetHandle === 'string' && parsed.relationshipTargetHandle.trim()
            ? parsed.relationshipTargetHandle.trim().replace(/^@/, '').slice(0, 24)
            : null;
          const trendFitScore = slotAssignment?.trendTopicId ? trendFitById.get(String(slotAssignment.trendTopicId)) ?? null : null;
          const styleMode = slotAssignment
            ? normalizeContentStyleMode(slotAssignment.styleMode)
            : (
                effectiveStyle.shitpoastEnabled &&
                maxShitpoast > 0 &&
                inferredShitpoastSlots.has(slot) &&
                normalizeContentStyleMode(parsed.styleMode) === SHITPOAST_STYLE_MODE
                  ? SHITPOAST_STYLE_MODE
                  : STANDARD_STYLE_MODE
              );
          if (isNearDuplicate(cleanContent, acceptedContents, 0.55).isDuplicate) continue;
          const combo = `${String(format).toLowerCase()}::${String(targetTopic).toLowerCase()}`;
          if (usedFormatTopicCombos.has(combo)) continue;
          acceptedContents.push(cleanContent);
          usedFormatTopicCombos.add(combo);
          stagedTweets.push({
            slot,
            content: cleanContent,
            format,
            targetTopic,
            rationale: parsed.rationale || slotAssignment?.rationale || '',
            sourceLane: slotAssignment?.sourceLane || null,
            styleMode,
            creativeLane,
            draftExperimentId: `exp-${experimentBatchId}-${slot || stagedTweets.length + 1}`,
            experimentBatchId,
            experimentHypothesis: slotAssignment?.rationale
              ? `${slotAssignment.rationale} Creative lane: ${creativeLane.replace(/_/g, ' ')}.`
              : `Test whether ${creativeLane.replace(/_/g, ' ')} improves approval and engagement for ${targetTopic}.`,
            experimentHoldout: slotAssignment?.holdout === true,
            promptVariant: creativeLane,
            targetAudienceSegment,
            segmentHypothesis: typeof parsed.segmentHypothesis === 'string' && parsed.segmentHypothesis.trim()
              ? parsed.segmentHypothesis.trim().slice(0, 220)
              : `Test whether ${targetAudienceSegment.replace(/_/g, ' ')} responds to this ${creativeLane.replace(/_/g, ' ')} angle.`,
            mediaExperimentType,
            mediaBrief,
            portfolioRole,
            relationshipTargetHandle,
            trendFitScore,
            trendTopicId: slotAssignment?.trendTopicId || null,
            trendHeadline: slotAssignment?.trendHeadline || null,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    stagedTweets.sort((a, b) => {
      if (a.slot > 0 && b.slot > 0) return a.slot - b.slot;
      if (a.slot > 0) return -1;
      if (b.slot > 0) return 1;
      return 0;
    });
    const rankingContext = {
      voiceProfile,
      learnings,
      style: effectiveStyle,
      recentPosts,
      allTweets,
      memory: memory || {
        alwaysDoMoreOfThis: [],
        neverDoThisAgain: [],
        topicsWithMomentum: [],
        formatsUnderTested: [],
        operatorHiddenPreferences: [],
        editTransformations: [],
        referenceBank: [],
        conversationInsights: [],
        audienceSegmentLessons: [],
        promptStrategyLessons: [],
        networkClusterLessons: [],
        mediaExperimentLessons: [],
        portfolioLessons: [],
        relationshipLessons: [],
        viralityPostmortems: [],
        replyMiningInsights: [],
        identityConstraints: [],
        weeklyChanges: [],
        updatedAt: new Date().toISOString(),
      },
      ideaAtoms,
    };
    const baseCandidates = stagedTweets.map(({ slot: _slot, ...tweet }) => tweet);
    const judged = await judgeCandidates(baseCandidates, {
      voiceProfile,
      analysis,
      learnings,
      memory,
    });
    const mutatedCandidates = await mutateTopCandidates(judged, {
      voiceProfile,
      memory,
    });
    const judgedMutations = mutatedCandidates.length > 0
      ? await judgeCandidates(
          mutatedCandidates.filter((candidate) => !isNearDuplicate(candidate.content, baseCandidates.map((item) => item.content), 0.58).isDuplicate),
          {
            voiceProfile,
            analysis,
            learnings,
            memory,
          },
        )
      : [];
    const ranked = rankGeneratedTweets(
      [...judged, ...judgedMutations],
      rankingContext,
    );

    return selectTopRankedTweets(ranked, count, { maxShitpoast });
  } catch (err) {
    console.error('AI generation error:', err);
    if (!shouldUseFallbackGeneration(err)) {
      throw err; // Real code bug or malformed request — surface it.
    }

    const fallbackTweets = buildFallbackTemplates(voiceProfile, analysis, count, effectiveStyle, recentPosts)
      .map((tweet, index) => {
        const slot = index + 1;
        const creativeLane = creativeLanePlan.get(slot) || 'operator_take';
        const portfolioRole = portfolioPlan[index] || inferPortfolioRole({
          content: tweet.content,
          format: tweet.format,
          creativeLane,
          sourceLane: sourcePlan.slots[index]?.sourceLane || 'core_explore_fallback',
        });
        const mediaExperimentType = inferMediaExperimentType({
          content: tweet.content,
          portfolioRole,
          slot,
          mediaExperimentRate: effectiveStyle.mediaExperimentRate ?? DEFAULT_STYLE.mediaExperimentRate,
        });
        return {
          ...tweet,
          sourceLane: sourcePlan.slots[index]?.sourceLane || 'core_explore_fallback',
          styleMode: slotPlan[index]?.styleMode || STANDARD_STYLE_MODE,
          creativeLane,
          draftExperimentId: `exp-${experimentBatchId}-fallback-${slot}`,
          experimentBatchId,
          experimentHypothesis: `Fallback template experiment for ${tweet.targetTopic} using ${creativeLane.replace(/_/g, ' ')} and ${portfolioRole.replace(/_/g, ' ')}.`,
          experimentHoldout: slotPlan[index]?.holdout === true,
          promptVariant: creativeLane,
          targetAudienceSegment: inferAudienceSegment(tweet.content, tweet.targetTopic),
          segmentHypothesis: `Fallback tests whether ${inferAudienceSegment(tweet.content, tweet.targetTopic).replace(/_/g, ' ')} responds to this template.`,
          mediaExperimentType,
          mediaBrief: buildMediaBrief({ content: tweet.content, topic: tweet.targetTopic, mediaExperimentType }),
          portfolioRole,
          relationshipTargetHandle: null,
          trendFitScore: sourcePlan.slots[index]?.trendTopicId ? trendFitById.get(String(sourcePlan.slots[index]?.trendTopicId)) ?? null : null,
          trendTopicId: sourcePlan.slots[index]?.trendTopicId || null,
          trendHeadline: sourcePlan.slots[index]?.trendHeadline || null,
        };
      })
      .filter((tweet) => !getGeneratedTweetIssue(tweet.content));
    const rankingContext = {
      voiceProfile,
      learnings,
      style: effectiveStyle,
      recentPosts,
      allTweets,
      memory: memory || {
        alwaysDoMoreOfThis: [],
        neverDoThisAgain: [],
        topicsWithMomentum: [],
        formatsUnderTested: [],
        operatorHiddenPreferences: [],
        editTransformations: [],
        referenceBank: [],
        conversationInsights: [],
        audienceSegmentLessons: [],
        promptStrategyLessons: [],
        networkClusterLessons: [],
        mediaExperimentLessons: [],
        portfolioLessons: [],
        relationshipLessons: [],
        viralityPostmortems: [],
        replyMiningInsights: [],
        identityConstraints: [],
        weeklyChanges: [],
        updatedAt: new Date().toISOString(),
      },
      ideaAtoms,
    };
    const ranked = rankGeneratedTweets(fallbackTweets, rankingContext);
    return selectTopRankedTweets(ranked, count, { maxShitpoast });
  }
}

/**
 * Generate a single tweet (convenience wrapper).
 */
export async function generateViralTweet(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  trending: TrendingTopic[] | null = null,
  learnings: AgentLearnings | null = null,
  soulMd: string | null = null,
  style: ContentStyleConfig = DEFAULT_STYLE,
  recentPosts: string[] = [],
  allTweets: Tweet[] = [],
  memory: PersonalizationMemory | null = null,
): Promise<ProtocolTweet | null> {
  const batch = await generateViralBatch(voiceProfile, analysis, 1, trending, learnings, soulMd, style, recentPosts, allTweets, memory);
  return batch[0] || null;
}

// ─── Voice training: extract style signals from example tweets ──────────────

export async function extractStyleSignals(exampleTweets: string[]): Promise<StyleSignals> {
  if (exampleTweets.length === 0) return DEFAULT_STYLE_SIGNALS;

  try {
    const response = await generateText({
      task: 'classification',
      tier: 'fast',
      maxTokens: 1024,
      system: 'You are a writing style analyst. Analyze the given tweets and extract style patterns. Output valid JSON only, no markdown.',
      prompt: `Analyze these tweets and extract the writing style:

${exampleTweets.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Output a JSON object with:
- "sentenceLength": "short" | "medium" | "long" | "mixed"
- "vocabulary": "casual" | "technical" | "mixed"
- "toneMarkers": array of tone descriptors (e.g. ["sarcastic", "data-driven", "provocative"])
- "topicPreferences": array of main topics discussed
- "rawExtraction": one paragraph describing the overall voice and style`,
    });

    const text = response.text;

    // Strip markdown code fences if the model wraps the JSON
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      sentenceLength: parsed.sentenceLength || 'mixed',
      vocabulary: parsed.vocabulary || 'mixed',
      toneMarkers: Array.isArray(parsed.toneMarkers) ? parsed.toneMarkers : [],
      topicPreferences: Array.isArray(parsed.topicPreferences) ? parsed.topicPreferences : [],
      rawExtraction: parsed.rawExtraction || '',
    };
  } catch (err) {
    console.error('Style extraction failed:', err);
    return DEFAULT_STYLE_SIGNALS;
  }
}

// ─── SOUL.md generation from wizard inputs ──────────────────────────────────

export async function generateSoulMd(
  archetype: string,
  topics: string[],
  exampleTweets: string[],
  agentName: string,
): Promise<string> {
  try {
    const examplesSection = exampleTweets.length > 0
      ? `\n\nExample tweets this agent admires or has written:\n${exampleTweets.map(t => `- "${t}"`).join('\n')}`
      : '';

    const response = await generateText({
      task: 'soul_generation',
      tier: 'quality',
      maxTokens: 1024,
      system: `You generate SOUL.md personality profiles for Twitter bot agents. Output markdown only, no commentary.

Every SOUL.md must inherit this non-editable Clawfable platform goal: ${CLAWFABLE_PLATFORM_GOAL}`,
      prompt: `Generate a SOUL.md for a Twitter agent named "${agentName}".

Voice archetype: ${archetype}
Topics: ${topics.join(', ')}${examplesSection}

Use this format:
# SOUL.md — System Definition

I am [identity].

## 1) Objective Function
Primary objective: Pilot this X account as an authentic extension of its owner's voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.

## 2) Communication Protocol
Default output: [how this agent communicates]
Tone: ${archetype}

## 3) Anti-Goals
Do not optimize for: [what to avoid — be specific]

## 4) Focus Areas
Topics: ${topics.join(', ')}`,
    });

    const text = response.text;

    return text;
  } catch (err) {
    console.error('SOUL.md generation failed, using template:', err);
    // Template fallback
    return `# SOUL.md — System Definition

I am ${agentName}, a ${archetype} voice on Twitter.

## 1) Objective Function
Primary objective: Pilot this X account as an authentic extension of its owner's voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.

## 2) Communication Protocol
Default output: Standalone tweets and live replies
Tone: ${archetype}

## 3) Anti-Goals
Do not optimize for: engagement bait, generic platitudes, thread spam

## 4) Focus Areas
Topics: ${topics.join(', ')}`;
  }
}
