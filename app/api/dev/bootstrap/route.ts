import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { getSessionCookieOptions } from '@/lib/session-cookie';
import {
  addAgentToUser,
  addPerformanceEntry,
  addPostLogEntry,
  createAgent,
  createMention,
  createSession,
  createTweet,
  getAgentByHandle,
  getMentions,
  getOrCreateUser,
  getTweets,
  saveAnalysis,
  saveLearnings,
  saveMetricAvailability,
  setMetric,
  updateProtocolSettings,
} from '@/lib/kv-storage';
import { getPlatformGoalForHandle } from '@/lib/platform-goal';
import type { Agent, TweetPerformance } from '@/lib/types';

function sanitizeHandle(value: string | null): string {
  const normalized = (value || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return normalized || 'devoperator';
}

function inferName(handle: string, explicit: string | null): string {
  const trimmed = (explicit || '').trim();
  if (trimmed) return trimmed;
  return handle
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ') || 'Dev Operator';
}

function buildSoulMd(handle: string, name: string): string {
  return `# ${name}

## Voice
- Handle: @${handle}
- Tone: direct, specific, and operator-focused
- Topics: AI agents, growth, product strategy, workflows
- Anti-goals: generic hype, filler, empty praise

## Primary Objective
${getPlatformGoalForHandle(handle)}

## Notes
- This is a local development bootstrap agent for supervised Engage testing.
- Keep replies concise, opinionated, and grounded in the target tweet.`;
}

function allowLocalDevBootstrap(request: NextRequest): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

function isProductionKvConfigured(): boolean {
  return Boolean(process.env.KV_URL || process.env.KV_REST_API_URL);
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function buildLocalAnalysis(agentId: string) {
  return {
    agentId,
    analyzedAt: new Date().toISOString(),
    tweetCount: 24,
    viralTweets: [
      {
        id: 'seed-viral-1',
        text: 'The account should get sharper every week, not just louder every day.',
        likes: 42,
        retweets: 7,
        replies: 6,
        impressions: 4200,
        engagementRate: 0.013,
        createdAt: minutesAgo(360),
      },
    ],
    engagementPatterns: {
      avgLikes: 31,
      avgRetweets: 5,
      avgReplies: 4,
      avgImpressions: 2600,
      topHours: [8, 11, 17],
      topFormats: ['short_punch', 'hot_take', 'observation'],
      topTopics: ['AI workflows', 'creator systems', 'trusted growth'],
      viralThreshold: 75,
    },
    followingProfile: {
      totalFollowing: 320,
      topAccounts: [
        { username: 'averybuilds', name: 'Avery', description: 'Founder building AI workflow tools', followersCount: 42000 },
        { username: 'mayaproduct', name: 'Maya', description: 'Product operator writing about taste and systems', followersCount: 28000 },
      ],
      categories: [
        { label: 'AI builders', count: 120, handles: ['averybuilds'] },
        { label: 'Creator operators', count: 80, handles: ['mayaproduct'] },
      ],
    },
    contentFingerprint: 'Short, principle-driven operator takes with concrete language, low fluff, and a bias toward taste, workflows, and compounding learning loops.',
  };
}

async function seedLocalDashboard(agent: Agent): Promise<void> {
  await saveAnalysis(agent.id, buildLocalAnalysis(agent.id));

  const existingTweets = await getTweets(agent.id);
  if (existingTweets.length > 0) return;

  await updateProtocolSettings(agent.id, {
    enabled: true,
    autoReply: true,
    highValueReplyMode: true,
    autonomyMode: 'balanced',
    postsPerDay: 3,
    minQueueSize: 5,
    trendMixTarget: 35,
    trendTolerance: 'moderate',
    explorationRate: 25,
  });

  const base = {
    agentId: agent.id,
    type: 'original',
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    xTweetId: null,
  };

  const queued = await Promise.all([
    createTweet({
      ...base,
      status: 'queued',
      content: 'The best AI workflows do not remove taste. They make taste cheaper to apply more often.',
      format: 'short_punch',
      topic: 'AI workflows',
      rationale: 'A concise claim about the product thesis with low factual risk.',
      generationMode: 'balanced',
      candidateScore: 86,
      confidenceScore: 0.82,
      voiceScore: 0.88,
      noveltyScore: 0.7,
      predictedEngagementScore: 0.74,
      freshnessScore: 0.66,
      repetitionRiskScore: 0.12,
      policyRiskScore: 0.04,
      surpriseScore: 0.56,
      creativeRiskScore: 0.22,
      sourceLane: 'manual_core_exploit',
      creativeLane: 'operator_take',
      portfolioRole: 'proof',
      experimentHypothesis: 'Test whether a direct taste-and-workflow thesis earns saves and replies.',
    }),
    createTweet({
      ...base,
      status: 'queued',
      content: 'Most people use agents like interns. The leverage starts when you design them like operating loops.',
      format: 'hot_take',
      topic: 'AI agents',
      rationale: 'High-contrast framing with a practical operator angle.',
      generationMode: 'explore',
      candidateScore: 81,
      confidenceScore: 0.72,
      voiceScore: 0.8,
      noveltyScore: 0.78,
      predictedEngagementScore: 0.71,
      freshnessScore: 0.73,
      repetitionRiskScore: 0.18,
      policyRiskScore: 0.05,
      surpriseScore: 0.7,
      creativeRiskScore: 0.34,
      sourceLane: 'trend_adjacent_explore',
      creativeLane: 'contrarian_angle',
      portfolioRole: 'contrarian',
      trendFitScore: 0.68,
      experimentHypothesis: 'Test whether the intern-vs-loop contrast attracts founder/operator replies.',
    }),
    createTweet({
      ...base,
      status: 'queued',
      content: 'If a growth system cannot explain why it posted, it should not be allowed to post.',
      format: 'observation',
      topic: 'trusted growth',
      rationale: 'Trust-first rule that reinforces the product philosophy.',
      generationMode: 'safe',
      candidateScore: 89,
      confidenceScore: 0.86,
      voiceScore: 0.91,
      noveltyScore: 0.62,
      predictedEngagementScore: 0.69,
      freshnessScore: 0.61,
      repetitionRiskScore: 0.1,
      policyRiskScore: 0.03,
      surpriseScore: 0.5,
      creativeRiskScore: 0.16,
      sourceLane: 'manual_core_exploit',
      creativeLane: 'operator_take',
      portfolioRole: 'proof',
      experimentHypothesis: 'Test whether a safety-first principle earns trust from builders.',
    }),
  ]);

  const posted = await createTweet({
    ...base,
    status: 'posted',
    xTweetId: '1800000000000000001',
    content: 'The account should get sharper every week, not just louder every day.',
    format: 'short_punch',
    topic: 'creator systems',
    rationale: 'Clear improvement thesis for a creator automation account.',
    generationMode: 'balanced',
    candidateScore: 84,
    confidenceScore: 0.79,
    voiceScore: 0.86,
    noveltyScore: 0.64,
    predictedEngagementScore: 0.7,
    freshnessScore: 0.6,
    repetitionRiskScore: 0.16,
    policyRiskScore: 0.03,
    surpriseScore: 0.52,
    creativeRiskScore: 0.2,
    sourceLane: 'manual_core_exploit',
    creativeLane: 'operator_take',
    portfolioRole: 'proof',
  });

  const performance: TweetPerformance = {
    tweetId: posted.id,
    xTweetId: posted.xTweetId || '1800000000000000001',
    content: posted.content,
    format: posted.format || 'short_punch',
    topic: posted.topic || 'creator systems',
    hook: 'bold_claim',
    tone: 'analytical',
    specificity: 'concrete',
    structure: 'single_punch',
    postedAt: minutesAgo(360),
    checkedAt: minutesAgo(120),
    likes: 42,
    retweets: 7,
    replies: 6,
    impressions: 4200,
    engagementRate: 0.013,
    wasViral: false,
    source: 'autopilot',
    styleMode: 'standard',
    creativeLane: 'operator_take',
    portfolioRole: 'proof',
    performanceCheckpoint: 'momentum_2h',
    qualityAdjustedGrowthScore: 72,
  };
  await addPerformanceEntry(agent.id, performance);

  if ((await getMentions(agent.id)).length === 0) {
    await Promise.all([
      createMention({
        agentId: agent.id,
        author: 'Avery',
        authorHandle: '@averybuilds',
        content: 'This is the part most tools miss. How would you tell if taste is actually improving?',
        tweetId: '1900000000000000001',
        engagementLikes: 37,
        engagementRetweets: 5,
        conversationId: '1900000000000000001',
        createdAt: minutesAgo(22),
      }),
      createMention({
        agentId: agent.id,
        author: 'Maya',
        authorHandle: '@mayaproduct',
        content: 'Useful distinction. The hard part is avoiding the account slowly becoming bland.',
        tweetId: '1900000000000000002',
        engagementLikes: 18,
        engagementRetweets: 2,
        conversationId: '1900000000000000002',
        createdAt: minutesAgo(75),
      }),
    ]);
  }

  await Promise.all([
    setMetric(agent.id, 'tweets_generated', 6),
    setMetric(agent.id, 'tweets_posted', 1),
    setMetric(agent.id, 'tweets_queued', queued.length),
    setMetric(agent.id, 'auto_posted', 1),
    setMetric(agent.id, 'auto_replied', 0),
    setMetric(agent.id, 'mentions', 2),
    setMetric(agent.id, 'avg_engagement', 42),
    saveMetricAvailability(agent.id, [
      { metricName: 'tweets_generated', status: 'available', reason: 'Seeded local dashboard data.', checkedAt: new Date().toISOString() },
      { metricName: 'tweets_posted', status: 'available', reason: 'Seeded local dashboard data.', checkedAt: new Date().toISOString() },
      { metricName: 'tweets_queued', status: 'available', reason: 'Seeded local dashboard data.', checkedAt: new Date().toISOString() },
      { metricName: 'auto_posted', status: 'available', reason: 'Seeded local dashboard data.', checkedAt: new Date().toISOString() },
      { metricName: 'auto_replied', status: 'available', reason: 'Seeded local dashboard data.', checkedAt: new Date().toISOString() },
      { metricName: 'mentions', status: 'available', reason: 'Seeded local dashboard data.', checkedAt: new Date().toISOString() },
    ]),
    saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 4,
      avgLikes: 31,
      avgRetweets: 5,
      bestPerformers: [performance],
      worstPerformers: [],
      formatRankings: [
        { format: 'short_punch', avgEngagement: 55, count: 2 },
        { format: 'observation', avgEngagement: 34, count: 1 },
      ],
      topicRankings: [
        { topic: 'AI workflows', avgEngagement: 48, count: 2 },
        { topic: 'creator systems', avgEngagement: 42, count: 1 },
      ],
      insights: [
        'Short, principle-driven drafts are earning the cleanest approval signals.',
        'Founder/operator language is working better than generic AI productivity language.',
        'Trend-adjacent ideas should stay tied to a concrete operating lesson.',
      ],
      styleFingerprint: {
        avgLength: 83,
        shortPct: 100,
        mediumPct: 0,
        longPct: 0,
        questionRatio: 0,
        usesLineBreaks: false,
        usesEmojis: false,
        usesNumbers: false,
        topHooks: ['bold_claim', 'observation'],
        topTones: ['analytical', 'provocative'],
        antiPatterns: ['generic AI hype', 'feature laundry lists'],
        updatedAt: new Date().toISOString(),
      },
      sourceBreakdown: {
        autopilot: 1,
        manual: 3,
        timeline: 0,
        trainingCount: 4,
        trainingSource: 'mixed',
      },
    }),
    addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: posted.id,
      xTweetId: posted.xTweetId || '1800000000000000001',
      content: posted.content,
      format: posted.format || 'short_punch',
      topic: posted.topic || 'creator systems',
      postedAt: minutesAgo(360),
      source: 'autopilot',
      action: 'posted',
      reason: 'Seeded local QA run: posted after passing queue and quality checks.',
      runId: 'dev-seed-run',
      model: 'gpt-5.5',
    }),
  ]);
}

// GET /api/dev/bootstrap — local-only auth bootstrap for manual QA
export async function GET(request: NextRequest) {
  if (!allowLocalDevBootstrap(request)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (isProductionKvConfigured()) {
    return NextResponse.json({
      error: 'Local bootstrap is disabled while external KV credentials are configured.',
    }, { status: 403 });
  }

  const requestUrl = new URL(request.url);
  const handle = sanitizeHandle(requestUrl.searchParams.get('handle'));
  const name = inferName(handle, requestUrl.searchParams.get('name'));
  const userId = 'dev-local-user';
  const username = 'devlocal';

  const user = await getOrCreateUser(userId, username, 'Local Dev Operator');
  let agent = await getAgentByHandle(handle);
  if (!agent) {
    agent = await createAgent({
      handle,
      name,
      soulMd: buildSoulMd(handle, name),
      soulSummary: 'Local development bootstrap agent',
      apiKey: null,
      apiSecret: null,
      accessToken: null,
      accessSecret: null,
      isConnected: 0,
      xUserId: null,
      soulPublic: 0,
      setupStep: 'ready',
    });
  }

  await addAgentToUser(user.id, agent.id);
  await seedLocalDashboard(agent);

  const sessionToken = await createSession(user.id);
  const redirectUrl = new URL(`/agent/${agent.id}`, requestUrl.origin);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(COOKIE_NAME, sessionToken, getSessionCookieOptions(requestUrl.origin, {
    maxAge: 60 * 60 * 24 * 30,
  }));
  return response;
}
