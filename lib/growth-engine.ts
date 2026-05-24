import type {
  AgentLearnings,
  AudienceSegment,
  ContentSourceLane,
  MediaExperimentType,
  Mention,
  PersonalizationMemory,
  PostLogEntry,
  PostPortfolioRole,
  ProtocolSettings,
  RelationshipOpportunity,
  ReplyMiningInsight,
  TrendOpportunity,
  TweetPerformance,
  ViralityPostmortem,
} from './types';
import type { EnrichedTrendingTopic } from './source-planner';
import { inferAudienceSegment } from './virality-signals';

export const PORTFOLIO_SEQUENCE: PostPortfolioRole[] = [
  'proof',
  'contrarian',
  'story',
  'reply_bait',
  'trend',
  'media',
  'relationship',
];

export const MEDIA_SEQUENCE: MediaExperimentType[] = ['text_only', 'image', 'screenshot', 'meme', 'video'];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeHandle(value: string | null | undefined): string {
  return (value || '').replace(/^@/, '').trim().toLowerCase();
}

function weightedEngagement(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return entry.likes + entry.retweets + (entry.replies * 2);
}

function parseDate(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function topicLabel(value: string | null | undefined): string {
  return (value || 'general').trim().replace(/[_-]+/g, ' ');
}

function rankLearnedRoles(learnings: AgentLearnings | null): PostPortfolioRole[] {
  return (learnings?.portfolioRolePerformance || [])
    .filter((entry) => entry.posts >= 2)
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.wins - a.wins)
    .map((entry) => entry.role);
}

export function normalizePortfolioRole(value: unknown): PostPortfolioRole {
  return PORTFOLIO_SEQUENCE.includes(value as PostPortfolioRole)
    ? value as PostPortfolioRole
    : 'proof';
}

export function normalizeMediaExperimentType(value: unknown): MediaExperimentType {
  return MEDIA_SEQUENCE.includes(value as MediaExperimentType)
    ? value as MediaExperimentType
    : 'text_only';
}

export function buildPostPortfolioPlan({
  count,
  settings,
  learnings,
}: {
  count: number;
  settings?: Partial<ProtocolSettings> | null;
  learnings?: AgentLearnings | null;
}): PostPortfolioRole[] {
  if (count <= 0) return [];

  if (settings?.portfolioOptimizerEnabled === false) {
    return Array.from({ length: count }, (_, index) => PORTFOLIO_SEQUENCE[index % 4]);
  }

  const learned = rankLearnedRoles(learnings);
  const base = [...new Set([...learned.slice(0, 3), ...PORTFOLIO_SEQUENCE])];
  const roles: PostPortfolioRole[] = [];
  for (let index = 0; index < count; index++) {
    roles.push(base[index % base.length]);
  }

  const hasMedia = roles.includes('media');
  const mediaRate = Math.max(0, Math.min(100, settings?.mediaExperimentRate ?? 15));
  if (!hasMedia && count >= 5 && mediaRate > 0) {
    roles[count - 1] = 'media';
  }
  if (!roles.includes('relationship') && count >= 7) {
    roles[Math.max(0, count - 2)] = 'relationship';
  }

  return roles;
}

export function inferPortfolioRole({
  content,
  format,
  creativeLane,
  sourceLane,
  mediaExperimentType,
}: {
  content: string;
  format?: string | null;
  creativeLane?: string | null;
  sourceLane?: ContentSourceLane | null;
  mediaExperimentType?: MediaExperimentType | null;
}): PostPortfolioRole {
  const text = content.toLowerCase();
  const normalizedFormat = (format || '').toLowerCase();
  if (mediaExperimentType && mediaExperimentType !== 'text_only') return 'media';
  if (sourceLane === 'trend_aligned_exploit' || sourceLane === 'trend_adjacent_explore' || creativeLane === 'trend_riff') return 'trend';
  if (/^@\w+/.test(content.trim()) || /\b(replying|someone asked|great question)\b/i.test(content)) return 'relationship';
  if (content.includes('?') || normalizedFormat === 'question' || /\bwhat would|which one|why do you think\b/i.test(content)) return 'reply_bait';
  if (creativeLane === 'story_example' || /\b(years ago|last week|today i|i saw|we tried|story)\b/i.test(content)) return 'story';
  if (creativeLane === 'contrarian_angle' || /\b(most people|everyone|nobody)\b.+\b(wrong|miss|underestimate|overrate)\b/i.test(content)) return 'contrarian';
  if (/\b\d+[%x]?\b|\$\d|\bdata\b|\bproof\b|\bcase study\b|\bbenchmark\b/i.test(text)) return 'proof';
  return 'proof';
}

export function inferMediaExperimentType({
  content,
  portfolioRole,
  slot,
  mediaExperimentRate = 15,
}: {
  content: string;
  portfolioRole?: PostPortfolioRole | null;
  slot?: number | null;
  mediaExperimentRate?: number;
}): MediaExperimentType {
  const text = content.toLowerCase();
  if (portfolioRole !== 'media') {
    const rate = Math.max(0, Math.min(100, mediaExperimentRate));
    if (!slot || rate <= 0 || (slot % Math.max(2, Math.round(100 / Math.max(rate, 1))) !== 0)) {
      return 'text_only';
    }
  }
  if (/\b(screenshot|interface|dashboard|terminal|chart|graph|table)\b/.test(text)) return 'screenshot';
  if (/\b(meme|absurd|joke|funny|weird)\b/.test(text)) return 'meme';
  if (/\b(video|walkthrough|demo|clip)\b/.test(text)) return 'video';
  return portfolioRole === 'media' ? 'image' : 'text_only';
}

export function buildMediaBrief({
  content,
  topic,
  mediaExperimentType,
}: {
  content: string;
  topic?: string | null;
  mediaExperimentType?: MediaExperimentType | null;
}): string | null {
  const type = normalizeMediaExperimentType(mediaExperimentType);
  if (type === 'text_only') return null;
  const cleanTopic = topicLabel(topic);
  const thesis = content.replace(/\s+/g, ' ').slice(0, 140);
  if (type === 'screenshot') return `Pair with a crisp screenshot or simple table that proves the ${cleanTopic} claim: ${thesis}`;
  if (type === 'meme') return `Pair with a simple native meme that makes the ${cleanTopic} insight instantly legible without weakening the claim.`;
  if (type === 'video') return `Pair with a short demo or talking-head clip showing the ${cleanTopic} point in motion: ${thesis}`;
  return `Pair with one clean visual that makes the ${cleanTopic} idea concrete: ${thesis}`;
}

export function buildTrendOpportunities(
  agentId: string,
  enriched: EnrichedTrendingTopic[],
): TrendOpportunity[] {
  const now = new Date().toISOString();
  return enriched
    .filter((topic) => topic.sourceLane !== 'reject')
    .sort((a, b) => b.fitScores.total - a.fitScores.total || b.relevanceScore - a.relevanceScore)
    .slice(0, 12)
    .map((topic) => ({
      id: `${agentId}:trend:${topic.id}:${parseDate(topic.timestamp) || Date.now()}`,
      agentId,
      topicId: String(topic.id),
      headline: topic.headline,
      category: topic.category,
      source: topic.source,
      topTweetId: topic.topTweet?.id || null,
      topTweetAuthor: topic.topTweet?.author || null,
      topTweetText: topic.topTweet?.text || null,
      topTweetLikes: topic.topTweet?.likes || 0,
      fitScore: topic.fitScores.total,
      sourceLane: topic.sourceLane,
      suggestedAngle: topic.plannerReason,
      status: 'new',
      createdAt: now,
    }));
}

export function mineReplyInsights(mentions: Mention[], limit = 8): ReplyMiningInsight[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const insights: ReplyMiningInsight[] = [];

  for (const mention of mentions) {
    const text = mention.content.trim();
    if (text.length < 12) continue;
    const lower = text.toLowerCase();
    const question = text.includes('?');
    const objection = /\b(but|wrong|disagree|why|how|what about|doesn't|isn't|can't)\b/.test(lower);
    const request = /\b(can you|could you|explain|break down|example|show)\b/.test(lower);
    if (!question && !objection && !request) continue;

    const theme = request ? 'requested explanation' : objection ? 'objection worth answering' : 'open question';
    const key = `${theme}:${lower.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = clamp(
      0.36
      + (question ? 0.18 : 0)
      + (objection ? 0.18 : 0)
      + (request ? 0.16 : 0)
      + Math.min(0.18, ((mention.engagementLikes || 0) + (mention.engagementRetweets || 0)) / 30),
    );

    insights.push({
      id: `${mention.id}:reply-insight`,
      authorHandle: mention.authorHandle,
      theme,
      prompt: `Answer @${mention.authorHandle.replace(/^@/, '')}'s ${theme}: ${text.slice(0, 180)}`,
      opportunityScore: Number(score.toFixed(3)),
      createdAt: now,
    });
  }

  return insights
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.prompt.localeCompare(b.prompt))
    .slice(0, limit);
}

export function buildRelationshipOpportunities({
  agentId,
  mentions,
  postLog,
  performanceHistory,
  limit = 12,
}: {
  agentId: string;
  mentions: Mention[];
  postLog: PostLogEntry[];
  performanceHistory: TweetPerformance[];
  limit?: number;
}): RelationshipOpportunity[] {
  const now = new Date().toISOString();
  const interactionCounts = new Map<string, { handle: string; likes: number; retweets: number; mentions: Mention[] }>();

  for (const mention of mentions) {
    const handle = normalizeHandle(mention.authorHandle);
    if (!handle) continue;
    const current = interactionCounts.get(handle) || { handle, likes: 0, retweets: 0, mentions: [] };
    current.likes += mention.engagementLikes || 0;
    current.retweets += mention.engagementRetweets || 0;
    current.mentions.push(mention);
    interactionCounts.set(handle, current);
  }

  for (const entry of postLog) {
    const match = entry.reason?.match(/@([a-zA-Z0-9_]{2,20})/) || entry.content.match(/^@([a-zA-Z0-9_]{2,20})/);
    const handle = normalizeHandle(match?.[1]);
    if (!handle) continue;
    const current = interactionCounts.get(handle) || { handle, likes: 0, retweets: 0, mentions: [] };
    interactionCounts.set(handle, current);
  }

  const recentWinningTopics = performanceHistory
    .filter((entry) => weightedEngagement(entry) >= 10)
    .slice(0, 25)
    .map((entry) => entry.topic)
    .filter(Boolean) as string[];

  return [...interactionCounts.values()]
    .map((entry) => {
      const latest = [...entry.mentions].sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt))[0] || null;
      const cluster = latest ? inferAudienceSegment(latest.content, recentWinningTopics[0] || latest.content) : 'reply_regulars';
      const questionBoost = latest?.content.includes('?') ? 0.14 : 0;
      const score = clamp(
        0.28
        + Math.min(0.24, entry.mentions.length * 0.06)
        + Math.min(0.22, (entry.likes + entry.retweets * 2) / 80)
        + questionBoost
      );
      const suggestedAction: RelationshipOpportunity['suggestedAction'] =
        latest?.tweetId ? 'reply' : entry.mentions.length >= 2 ? 'study' : 'follow';

      return {
        id: `${agentId}:relationship:${entry.handle}`,
        agentId,
        handle: entry.handle,
        name: latest?.author || null,
        tweetId: latest?.tweetId || null,
        tweetUrl: latest?.tweetId ? `https://x.com/${entry.handle}/status/${latest.tweetId}` : null,
        contentSample: latest?.content || null,
        networkCluster: cluster,
        score: Math.round(score * 100),
        reason: latest
          ? `Recurring or high-signal reply from @${entry.handle}; answer with substance or study their language.`
          : `@${entry.handle} appears in recent interaction logs and may be worth relationship-building.`,
        suggestedAction,
        status: 'new',
        lastSeenAt: latest?.createdAt || now,
        createdAt: now,
      } satisfies RelationshipOpportunity;
    })
    .sort((a, b) => b.score - a.score || parseDate(b.lastSeenAt) - parseDate(a.lastSeenAt))
    .slice(0, limit);
}

export function shouldCreateVelocityFollowup(entry: TweetPerformance): boolean {
  if (!entry.xTweetId || !entry.content.trim()) return false;
  if (entry.source !== 'autopilot' && entry.source !== 'manual') return false;
  if (entry.performanceCheckpoint !== 'early_30m' && entry.performanceCheckpoint !== 'momentum_2h') return false;
  const score = entry.earlyVelocityScore ?? 0;
  return score >= 0.58 || entry.replies >= 2 || weightedEngagement(entry) >= 24;
}

export function buildVelocityFollowupFallback(entry: TweetPerformance): string {
  const topic = topicLabel(entry.topic);
  const hook = entry.replies >= 2
    ? 'The replies are circling the same mistake:'
    : 'The thing I would add:';
  const point = entry.thesis && entry.thesis.length > 20
    ? entry.thesis
    : entry.content.replace(/\s+/g, ' ').slice(0, 120);
  return `${hook}\n\n${point}\n\nThe interesting part is not the headline. It is what compounds after everyone notices ${topic}.`;
}

export function buildViralityPostmortem(
  agentId: string,
  entry: TweetPerformance,
): ViralityPostmortem {
  const engagement = weightedEngagement(entry);
  const win = entry.wasViral || engagement >= 40;
  const replyDense = entry.replies >= Math.max(2, Math.round(entry.likes * 0.15));
  const media = entry.mediaExperimentType || 'text_only';
  const factors = [
    entry.hook ? `Hook: ${String(entry.hook).replace(/_/g, ' ')}` : '',
    entry.structure ? `Structure: ${String(entry.structure).replace(/_/g, ' ')}` : '',
    entry.targetAudienceSegment ? `Audience: ${entry.targetAudienceSegment.replace(/_/g, ' ')}` : '',
    replyDense ? 'High reply density' : '',
    (entry.earlyVelocityScore || 0) >= 0.58 ? 'Fast early velocity' : '',
    media !== 'text_only' ? `Media test: ${media}` : '',
  ].filter(Boolean);
  const misses = [
    entry.slopScore && entry.slopScore >= 0.45 ? 'Reduce generic phrasing/slop risk.' : '',
    entry.creativeRiskScore && entry.creativeRiskScore >= 0.55 ? 'Keep the creative edge but tighten voice fit.' : '',
    entry.replies === 0 && entry.replyBaitScore && entry.replyBaitScore >= 0.55 ? 'The reply forecast was too optimistic; test a clearer question.' : '',
    !win && engagement < 8 ? 'The angle did not create enough visible action reward.' : '',
  ].filter(Boolean);

  return {
    id: `${agentId}:postmortem:${entry.xTweetId}`,
    agentId,
    tweetId: entry.tweetId,
    xTweetId: entry.xTweetId,
    content: entry.content,
    postedAt: entry.postedAt,
    analyzedAt: new Date().toISOString(),
    score: engagement,
    performanceSummary: `${entry.likes} likes, ${entry.retweets} reposts, ${entry.replies} replies, ${entry.impressions} impressions.`,
    winningFactors: factors.length > 0 ? factors.slice(0, 5) : ['No dominant winning factor detected yet.'],
    misses: misses.length > 0 ? misses.slice(0, 4) : ['No major miss detected from available metrics.'],
    nextExperiments: [
      entry.portfolioRole ? `Retest ${entry.portfolioRole.replace(/_/g, ' ')} with a different hook.` : 'Retest the core thesis in a different portfolio role.',
      entry.targetAudienceSegment ? `Aim a follow-up at ${entry.targetAudienceSegment.replace(/_/g, ' ')}.` : 'Aim a follow-up at the reply segment that engaged.',
      media === 'text_only' ? 'Try a visual/media version if the claim can be made concrete.' : 'Compare this media format against a text-only holdout.',
    ],
    portfolioRole: entry.portfolioRole ?? null,
    mediaExperimentType: entry.mediaExperimentType ?? null,
    targetAudienceSegment: entry.targetAudienceSegment ?? null,
    promptStrategy: entry.promptStrategy ?? null,
  };
}

function summarizePerformanceRows<T extends string>(
  rows: Array<{ key: T; posts: number; avgEngagement: number; wins: number }>,
  label: string,
): string[] {
  return rows
    .filter((row) => row.posts > 0)
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.wins - a.wins)
    .slice(0, 4)
    .map((row) => `${label} ${row.key.replace(/_/g, ' ')} averages ${row.avgEngagement} engagement across ${row.posts} post${row.posts === 1 ? '' : 's'}.`);
}

export function summarizePortfolioLessons(learnings: AgentLearnings | null): string[] {
  return summarizePerformanceRows(
    (learnings?.portfolioRolePerformance || []).map((entry) => ({ key: entry.role, posts: entry.posts, avgEngagement: entry.avgEngagement, wins: entry.wins })),
    'Portfolio role',
  );
}

export function summarizeMediaExperimentLessons(learnings: AgentLearnings | null): string[] {
  return summarizePerformanceRows(
    (learnings?.mediaExperimentPerformance || []).map((entry) => ({ key: entry.type, posts: entry.posts, avgEngagement: entry.avgEngagement, wins: entry.wins })),
    'Media format',
  );
}

export function summarizeNetworkClusterLessons(learnings: AgentLearnings | null): string[] {
  return summarizePerformanceRows(
    (learnings?.networkClusterPerformance || []).map((entry) => ({ key: entry.cluster, posts: entry.posts, avgEngagement: entry.avgEngagement, wins: entry.wins })),
    'Network cluster',
  );
}

export function summarizeRelationshipLessons(learnings: AgentLearnings | null): string[] {
  return (learnings?.topRelationshipHandles || [])
    .slice(0, 5)
    .map((entry) => `Relationship target @${entry.handle} has ${entry.interactions} interactions with avg ${entry.avgEngagement} engagement.`);
}

export function summarizeViralityPostmortemMemory(learnings: AgentLearnings | null): string[] {
  return (learnings?.viralityPostmortems || [])
    .slice(0, 5)
    .map((entry) => `${entry.performanceSummary} Winning factors: ${entry.winningFactors.slice(0, 2).join('; ')} Next: ${entry.nextExperiments[0] || 'retest the angle'}`);
}

export function summarizeReplyMiningInsights(insights: ReplyMiningInsight[]): string[] {
  return insights
    .slice(0, 5)
    .map((insight) => `${insight.theme}: ${insight.prompt}`);
}

export function defaultPersonalizationMemory(): PersonalizationMemory {
  return {
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
  };
}
