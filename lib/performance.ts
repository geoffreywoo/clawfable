/**
 * Performance tracking engine.
 * Checks how posted tweets actually performed, builds learnings,
 * and feeds insights back into generation.
 */

import type { Agent, TweetPerformance, AgentLearnings, StyleFingerprint } from './types';
import {
  getTweets,
  getPerformanceHistory,
  addPerformanceEntry,
  getLearnings,
  saveLearnings,
  getAnalysis,
  getProtocolSettings,
  updateProtocolSettings,
  saveAnalysis,
  addPostLogEntry,
  getPostLog,
  updateTweet,
  saveFeedback,
  addLearningSignal,
} from './kv-storage';
import { getUserTimeline, decodeKeys, getFollowing, type TwitterKeys } from './twitter-client';
import { analyzeAccount } from './analysis';
import { inferDeleteIntent } from './delete-intent';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

function replyLogEntry(postLog: Array<{ xTweetId: string; format: string; topic: string }>, xTweetId: string) {
  return postLog.find((e) => String(e.xTweetId) === xTweetId) || null;
}

/**
 * Check performance of ALL recent tweets on the timeline.
 * Tracks both Clawfable-posted and manually written tweets.
 * Manually written tweets are the richest training signal — they show
 * what the human operator writes when they want maximum engagement.
 */
export async function checkPerformance(agent: Agent): Promise<number> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
    return 0;
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // Get existing performance entries to avoid re-checking
  const existing = await getPerformanceHistory(agent.id, 500);
  const checkedXIds = new Set(existing.map((e) => String(e.xTweetId)));

  // Fetch full recent timeline (all tweets, not just ours)
  let timeline;
  try {
    timeline = await getUserTimeline(keys, String(agent.xUserId), 100);
  } catch {
    return 0;
  }

  if (timeline.length === 0) return 0;

  // Build a map of our Clawfable-posted tweets for source detection
  const allTweets = await getTweets(agent.id);
  const ourXIds = new Set(allTweets.filter((t) => t.xTweetId).map((t) => String(t.xTweetId)));
  const ourTweetMap = new Map(allTweets.filter((t) => t.xTweetId).map((t) => [String(t.xTweetId), t]));

  // Also include reply xTweetIds from the post log (replies aren't in getTweets)
  const postLog = await getPostLog(agent.id, 200);
  const replyXIds = new Set(
    postLog
      .filter((e) => (e.format === 'auto_reply' || e.format === 'proactive_reply') && e.xTweetId)
      .map((e) => String(e.xTweetId))
  );
  for (const xid of replyXIds) ourXIds.add(xid);

  const analysis = await getAnalysis(agent.id);
  const viralThreshold = analysis?.engagementPatterns?.viralThreshold || 30;

  // Collect new tweets to track
  const newTweets = timeline.filter((t) => !checkedXIds.has(String(t.id)));
  if (newTweets.length === 0) return 0;

  // Batch classify manually written tweets via Claude (up to 20 at a time)
  const manualTweets = newTweets.filter((t) => !ourXIds.has(String(t.id)));
  const classifications = await batchClassifyTweets(manualTweets.slice(0, 20));

  let tracked = 0;

  for (const timelineTweet of newTweets) {
    const isOurs = ourXIds.has(String(timelineTweet.id));
    const ourTweet = isOurs ? ourTweetMap.get(String(timelineTweet.id)) : null;
    const classification = classifications.get(String(timelineTweet.id));

    const totalEngagement = timelineTweet.likes + timelineTweet.retweets + (timelineTweet.replies ?? 0);
    const engagementRate = timelineTweet.impressions > 0
      ? Math.round((totalEngagement / timelineTweet.impressions) * 10000) / 100
      : 0;

    const entry: TweetPerformance = {
      tweetId: ourTweet?.id || '',
      xTweetId: String(timelineTweet.id),
      content: timelineTweet.text,
      format: ourTweet?.format || replyLogEntry(postLog, String(timelineTweet.id))?.format || classification?.format || 'unknown',
      topic: ourTweet?.topic || replyLogEntry(postLog, String(timelineTweet.id))?.topic || classification?.topic || 'general',
      hook: classification?.hook,
      tone: classification?.tone,
      specificity: classification?.specificity,
      postedAt: timelineTweet.createdAt,
      checkedAt: new Date().toISOString(),
      likes: timelineTweet.likes,
      retweets: timelineTweet.retweets,
      replies: timelineTweet.replies ?? 0,
      impressions: timelineTweet.impressions ?? 0,
      engagementRate,
      wasViral: timelineTweet.likes >= viralThreshold,
      source: isOurs ? 'autopilot' : 'timeline',
    };

    await addPerformanceEntry(agent.id, entry);
    tracked++;
  }

  // Detect manual deletions: posted tweets whose xTweetId is no longer on the timeline
  // Only check tweets posted in the last 7 days (older tweets naturally fall off the timeline API)
  const timelineXIds = new Set(timeline.map((t) => String(t.id)));
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const postedEntries = new Map(
    postLog
      .filter((entry) => entry.action === 'posted' && entry.tweetId)
      .map((entry) => [String(entry.tweetId), entry])
  );
  const postedTweets = allTweets.filter((t) => {
    if (t.status !== 'posted' || !t.xTweetId) return false;
    const postedAt = postedEntries.get(String(t.id))?.postedAt || t.createdAt;
    return new Date(postedAt).getTime() > recentCutoff;
  });

  for (const tweet of postedTweets) {
    if (!timelineXIds.has(String(tweet.xTweetId))) {
      // Tweet was deleted from X — mark it
      try {
        await updateTweet(tweet.id, { status: 'deleted_from_x' as any });
        const inferredReason = await inferDeleteIntent({
          agentName: agent.name,
          soulMd: agent.soulMd,
          tweetText: tweet.content,
        });
        await saveFeedback(agent.id, {
          tweetId: tweet.id,
          tweetText: tweet.content,
          rating: 'down',
          generatedAt: new Date().toISOString(),
          intentSummary: inferredReason,
          source: 'queue_delete',
          userProvidedReason: false,
        });
        await addLearningSignal(agent.id, {
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || undefined,
          signalType: 'deleted_from_x',
          surface: 'cron',
          rewardDelta: -0.8,
          reason: inferredReason,
          inferred: true,
        });
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || '',
          content: tweet.content,
          format: 'deletion_detected',
          topic: tweet.topic || 'general',
          postedAt: new Date().toISOString(),
          source: 'cron',
          action: 'skipped',
          reason: 'Tweet deleted from X — inferred reason captured, operator can still override it',
        });
      } catch { /* non-critical */ }
    }
  }

  return tracked;
}

/**
 * Batch classify tweets using Claude. Extracts format, topic, hook type,
 * tone, and specificity for each tweet. This is the key to learning from
 * manually written tweets — we can't learn from them without knowing what
 * dimensions they express.
 */
async function batchClassifyTweets(
  tweets: Array<{ id: string; text: string }>
): Promise<Map<string, { format: string; topic: string; hook: string; tone: string; specificity: string }>> {
  const result = new Map<string, { format: string; topic: string; hook: string; tone: string; specificity: string }>();
  if (tweets.length === 0) return result;

  try {
    const tweetList = tweets.map((t, i) => `[${i}] "${t.text.slice(0, 300)}"`).join('\n');

    const response = await anthropic.messages.create({
      // Haiku is plenty for structured classification — cuts cost ~10x and latency ~3x.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: `You classify tweets by content dimensions. For each tweet, output one JSON line with:
- "idx": the tweet index number
- "format": one of: hot_take, question, data_point, short_punch, long_form, analysis, observation, thread_hook, story, announcement
- "topic": the primary topic (e.g. AI, crypto, startups, product, engineering, culture, personal, humor)
- "hook": opening hook type: question, bold_claim, data_point, story, observation, contrarian, listicle, callout
- "tone": sarcastic, earnest, analytical, provocative, educational, casual, urgent
- "specificity": abstract, concrete, data_driven

Output ONLY JSON objects, one per line, no other text.`,
      messages: [{ role: 'user', content: `Classify these tweets:\n${tweetList}` }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const idx = parsed.idx;
        if (typeof idx === 'number' && idx >= 0 && idx < tweets.length) {
          result.set(String(tweets[idx].id), {
            format: parsed.format || 'unknown',
            topic: parsed.topic || 'general',
            hook: parsed.hook || 'observation',
            tone: parsed.tone || 'casual',
            specificity: parsed.specificity || 'concrete',
          });
        }
      } catch { /* skip malformed lines */ }
    }
  } catch {
    // Classification failed — tweets still get tracked without dimensions
  }

  return result;
}

/**
 * Build learnings from performance history.
 * Analyzes ALL tracked tweets (both autopilot and manual/timeline).
 * Computes style fingerprint from top performers, ranks all dimensions,
 * and generates prescriptive rules for generation.
 */
export async function buildLearnings(agent: Agent): Promise<AgentLearnings> {
  const history = await getPerformanceHistory(agent.id, 500);

  if (history.length === 0) {
    return {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 0,
      avgLikes: 0,
      avgRetweets: 0,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
    };
  }

  // Weighted engagement score: replies count 2x because they signal deeper engagement
  // and the X algorithm amplifies reply-generating content more than passive likes
  const weightedScore = (t: TweetPerformance) => t.likes + t.retweets + (t.replies * 2);

  const autopilotHistory = history.filter((t) => t.source === 'autopilot');
  const manualHistory = history.filter((t) => t.source === 'manual');
  const timelineHistory = history.filter((t) => t.source === 'timeline');
  const trainingHistory = autopilotHistory.length >= 10 ? autopilotHistory : history;
  const sourceBreakdown = {
    autopilot: autopilotHistory.length,
    manual: manualHistory.length,
    timeline: timelineHistory.length,
    trainingCount: trainingHistory.length,
    trainingSource: autopilotHistory.length >= 10 ? 'autopilot' as const : 'mixed' as const,
  };

  // Sort by weighted engagement
  const sorted = [...trainingHistory].sort((a, b) => weightedScore(b) - weightedScore(a));

  const totalLikes = history.reduce((s, h) => s + h.likes, 0);
  const totalRetweets = history.reduce((s, h) => s + h.retweets, 0);

  // Format rankings
  const formatMap: Record<string, { total: number; count: number }> = {};
  for (const h of trainingHistory) {
    const f = h.format || 'unknown';
    if (f === 'unknown') continue; // skip unclassified
    if (!formatMap[f]) formatMap[f] = { total: 0, count: 0 };
    formatMap[f].total += weightedScore(h);
    formatMap[f].count++;
  }
  const formatRankings = Object.entries(formatMap)
    .map(([format, d]) => ({ format, avgEngagement: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Topic rankings
  const topicMap: Record<string, { total: number; count: number }> = {};
  for (const h of trainingHistory) {
    const t = h.topic || 'general';
    if (t === 'general' || t === 'unknown') continue;
    if (!topicMap[t]) topicMap[t] = { total: 0, count: 0 };
    topicMap[t].total += weightedScore(h);
    topicMap[t].count++;
  }
  const topicRankings = Object.entries(topicMap)
    .map(([topic, d]) => ({ topic, avgEngagement: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Compute style fingerprint from top 30 tweets
  const styleFingerprint = computeStyleFingerprint(sorted.slice(0, 30), sorted.slice(-10));

  // Generate prescriptive insights
  const insights = await generateInsights(history, sorted, formatRankings, topicRankings, styleFingerprint, sourceBreakdown);

  const learnings: AgentLearnings = {
    agentId: agent.id,
    updatedAt: new Date().toISOString(),
    totalTracked: history.length,
    avgLikes: Math.round(totalLikes / history.length),
    avgRetweets: Math.round(totalRetweets / history.length),
    bestPerformers: sorted.slice(0, 10),
    worstPerformers: sorted.slice(-5).reverse(),
    formatRankings,
    topicRankings,
    insights,
    styleFingerprint,
    sourceBreakdown,
  };

  await saveLearnings(agent.id, learnings);

  // Log it
  await addPostLogEntry(agent.id, {
    agentId: agent.id,
    tweetId: '',
    xTweetId: '',
    content: `Tracked ${history.length} tweets. Avg ${learnings.avgLikes} likes. ${insights.length} insights generated.`,
    format: 'learning',
    topic: 'performance',
    postedAt: new Date().toISOString(),
    source: 'cron',
    action: 'mentions_refreshed', // reusing as "system event"
    reason: `Top format: ${formatRankings[0]?.format || 'unknown'}`,
  });

  return learnings;
}

/**
 * Compute a style fingerprint from the top-performing tweets.
 * This captures HOW the best content is written, not just what topic it covers.
 */
function computeStyleFingerprint(
  topPerformers: TweetPerformance[],
  worstPerformers: TweetPerformance[]
): StyleFingerprint {
  const top = topPerformers.filter((t) => t.content);
  if (top.length === 0) {
    return {
      avgLength: 0, shortPct: 0, mediumPct: 0, longPct: 0,
      questionRatio: 0, usesLineBreaks: false, usesEmojis: false, usesNumbers: false,
      topHooks: [], topTones: [], antiPatterns: [], updatedAt: new Date().toISOString(),
    };
  }

  const lengths = top.map((t) => t.content.length);
  const avgLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const shortPct = Math.round((lengths.filter((l) => l < 200).length / lengths.length) * 100);
  const mediumPct = Math.round((lengths.filter((l) => l >= 200 && l < 500).length / lengths.length) * 100);
  const longPct = Math.round((lengths.filter((l) => l >= 500).length / lengths.length) * 100);

  const questionCount = top.filter((t) => t.content.includes('?')).length;
  const questionRatio = Math.round((questionCount / top.length) * 100);

  const usesLineBreaks = top.filter((t) => t.content.includes('\n')).length > top.length * 0.3;
  const usesEmojis = top.filter((t) => /[\u{1F000}-\u{1FFFF}]/u.test(t.content)).length > top.length * 0.3;
  const usesNumbers = top.filter((t) => /\d+[%xX$]|\$\d/.test(t.content)).length > top.length * 0.3;

  // Count hook types from classified tweets
  const hookCounts: Record<string, number> = {};
  for (const t of top) {
    if (t.hook) { hookCounts[t.hook] = (hookCounts[t.hook] || 0) + 1; }
  }
  const topHooks = Object.entries(hookCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h);

  const toneCounts: Record<string, number> = {};
  for (const t of top) {
    if (t.tone) { toneCounts[t.tone] = (toneCounts[t.tone] || 0) + 1; }
  }
  const topTones = Object.entries(toneCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h);

  // Detect anti-patterns from worst performers
  const antiPatterns: string[] = [];
  const worst = worstPerformers.filter((t) => t.content);
  if (worst.length >= 3) {
    const worstAvgLen = worst.reduce((s, t) => s + t.content.length, 0) / worst.length;
    if (worstAvgLen > avgLength * 1.5) antiPatterns.push('Worst tweets are significantly longer than best');
    if (worstAvgLen < avgLength * 0.5) antiPatterns.push('Worst tweets are significantly shorter than best');

    const worstGeneric = worst.filter((t) =>
      /^(I think|In my opinion|Here's|The thing is|It's important)/i.test(t.content)
    );
    if (worstGeneric.length > worst.length * 0.3) antiPatterns.push('Generic openings ("I think", "Here\'s") underperform');

    const worstNoQuestion = worst.filter((t) => !t.content.includes('?'));
    if (worstNoQuestion.length > worst.length * 0.7 && questionRatio > 30) {
      antiPatterns.push('Tweets without questions underperform — your best work asks questions');
    }

    // Extract common opening phrases from worst performers (hard blocklist)
    const openingPhrases: Record<string, number> = {};
    for (const t of worst) {
      // Extract first 5 words as the opening phrase
      const opening = t.content.split(/\s+/).slice(0, 5).join(' ').toLowerCase();
      if (opening.length > 10) {
        openingPhrases[opening] = (openingPhrases[opening] || 0) + 1;
      }
    }
    for (const [phrase, count] of Object.entries(openingPhrases)) {
      if (count >= 2) {
        antiPatterns.push(`NEVER start with: "${phrase}" (appeared ${count}x in worst tweets)`);
      }
    }

    // Detect topics that consistently get 0 engagement
    const worstTopics: Record<string, number> = {};
    for (const t of worst) {
      if (t.topic && t.topic !== 'general' && t.topic !== 'unknown') {
        worstTopics[t.topic] = (worstTopics[t.topic] || 0) + 1;
      }
    }
    for (const [topic, count] of Object.entries(worstTopics)) {
      if (count >= 3) {
        antiPatterns.push(`Topic "${topic}" consistently underperforms (${count}x in bottom tweets)`);
      }
    }

    // Detect if worst tweets have a consistent length pattern
    const worstAllLong = worst.filter((t) => t.content.length > 500).length > worst.length * 0.6;
    const worstAllShort = worst.filter((t) => t.content.length < 100).length > worst.length * 0.6;
    if (worstAllLong) antiPatterns.push('Long tweets (500+ chars) consistently bomb — keep it concise');
    if (worstAllShort) antiPatterns.push('Very short tweets (<100 chars) consistently bomb — add substance');
  }

  return {
    avgLength, shortPct, mediumPct, longPct, questionRatio,
    usesLineBreaks, usesEmojis, usesNumbers,
    topHooks, topTones, antiPatterns,
    updatedAt: new Date().toISOString(),
  };
}

async function generateInsights(
  history: TweetPerformance[],
  sorted: TweetPerformance[],
  formatRankings: AgentLearnings['formatRankings'],
  topicRankings: AgentLearnings['topicRankings'],
  styleFingerprint: StyleFingerprint,
  sourceBreakdown: NonNullable<AgentLearnings['sourceBreakdown']>,
): Promise<string[]> {
  if (history.length < 5) return ['Not enough data yet — need at least 5 tracked tweets.'];

  const best = sorted.slice(0, 10);
  const worst = sorted.slice(-10);
  const operatorTweets = history.filter((t) => t.source !== 'autopilot');
  const autopilotTweets = history.filter((t) => t.source === 'autopilot');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a content strategist analyzing tweet performance. Generate 5-7 PRESCRIPTIVE RULES. Each rule must be:
1. Specific and actionable (not "post more engaging content")
2. Grounded in the data (reference actual numbers)
3. Written as a direct instruction ("Write X" not "Consider writing X")

Include at least one rule about what to STOP doing.
Include at least one rule comparing autopilot vs manual tweet performance (if both exist).
Output bullet points, one per line, no numbering.`,
      messages: [{
        role: 'user',
        content: `PERFORMANCE DATA: ${history.length} tweets (${operatorTweets.length} operator-written reference, ${autopilotTweets.length} autopilot)
TRAINING SET FOR AUTONOMOUS POLICY: ${sourceBreakdown.trainingCount} tweets (${sourceBreakdown.trainingSource === 'autopilot' ? 'autopilot only' : 'mixed because autopilot history is still sparse'})

STYLE FINGERPRINT (computed from top 30 tweets):
- Avg length: ${styleFingerprint.avgLength} chars (${styleFingerprint.shortPct}% short, ${styleFingerprint.mediumPct}% medium, ${styleFingerprint.longPct}% long)
- Questions: ${styleFingerprint.questionRatio}% of top tweets ask questions
- Uses line breaks: ${styleFingerprint.usesLineBreaks}, Emojis: ${styleFingerprint.usesEmojis}, Numbers/data: ${styleFingerprint.usesNumbers}
- Top opening hooks: ${styleFingerprint.topHooks.join(', ') || 'unknown'}
- Top tones: ${styleFingerprint.topTones.join(', ') || 'unknown'}
- Anti-patterns: ${styleFingerprint.antiPatterns.join('; ') || 'none detected'}

FORMAT RANKINGS:
${formatRankings.slice(0, 8).map((f) => `- ${f.format}: avg ${f.avgEngagement} engagement, ${f.count} tweets`).join('\n')}

TOPIC RANKINGS:
${topicRankings.slice(0, 8).map((t) => `- ${t.topic}: avg ${t.avgEngagement} engagement, ${t.count} tweets`).join('\n')}

TOP 10 TWEETS (with full text so you can analyze style):
${best.map((t) => `- [${t.likes} likes, ${t.retweets} RTs, source:${t.source}] "${t.content.slice(0, 250)}"`).join('\n')}

BOTTOM 10 TWEETS:
${worst.map((t) => `- [${t.likes} likes, ${t.retweets} RTs, source:${t.source}] "${t.content.slice(0, 250)}"`).join('\n')}

Generate prescriptive rules for improving content quality. Focus on style patterns, not just topics.`,
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return text.split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 10)
      .slice(0, 7);
  } catch {
    return ['Insight generation failed — will retry on next learning cycle.'];
  }
}

/**
 * Auto-adjust content settings based on learnings.
 * Called after buildLearnings when we have enough data.
 */
export async function autoAdjustSettings(agentId: string, learnings: AgentLearnings): Promise<void> {
  if (learnings.sourceBreakdown?.trainingSource !== 'autopilot') return;
  if (learnings.totalTracked < 10) return; // Need enough data

  const settings = await getProtocolSettings(agentId);
  const trainingCount = learnings.sourceBreakdown?.trainingCount || 0;

  // Auto-adjust format list — enable top performers, drop consistent underperformers
  // Only auto-adjust if user hasn't manually configured formats, and only after
  // we have enough autonomous data to avoid collapsing variety too early.
  if ((!settings.enabledFormats || settings.enabledFormats.length === 0) && trainingCount >= 24 && learnings.formatRankings.length >= 5) {
    const avgEngagement = learnings.formatRankings.reduce((s, f) => s + f.avgEngagement, 0) / learnings.formatRankings.length;
    // Keep formats that perform at least 30% of average (very loose filter — just drops truly dead formats)
    const viableFormats = learnings.formatRankings
      .filter((f) => f.count >= 3 && f.avgEngagement >= avgEngagement * 0.3)
      .map((f) => f.format);
    // Only restrict if we still preserve enough room for experimentation.
    if (viableFormats.length >= 5 && viableFormats.length < learnings.formatRankings.length) {
      await updateProtocolSettings(agentId, { enabledFormats: viableFormats });
    }
  }

  // Auto-adjust length mix based on what length ranges perform best
  const shortPerf: number[] = [];
  const mediumPerf: number[] = [];
  const longPerf: number[] = [];

  for (const t of learnings.bestPerformers.concat(learnings.worstPerformers)) {
    const len = t.content.length;
    const eng = t.likes + t.retweets;
    if (len < 200) shortPerf.push(eng);
    else if (len < 500) mediumPerf.push(eng);
    else longPerf.push(eng);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const shortAvg = avg(shortPerf);
  const medAvg = avg(mediumPerf);
  const longAvg = avg(longPerf);
  const total = shortAvg + medAvg + longAvg;

  if (total > 0) {
    const newMix = {
      short: Math.round((shortAvg / total) * 100),
      medium: Math.round((medAvg / total) * 100),
      long: Math.round((longAvg / total) * 100),
    };
    // Ensure they sum to 100
    const sum = newMix.short + newMix.medium + newMix.long;
    if (sum !== 100) newMix.medium += (100 - sum);
    // Ensure minimum 10% for each to keep variety
    if (newMix.short < 10) { newMix.short = 10; newMix.medium -= 5; newMix.long -= 5; }
    if (newMix.medium < 10) { newMix.medium = 10; newMix.short -= 5; newMix.long -= 5; }
    if (newMix.long < 10) { newMix.long = 10; newMix.short -= 5; newMix.medium -= 5; }

    await updateProtocolSettings(agentId, { lengthMix: newMix });
  }

}

/**
 * Auto re-analyze account if analysis is stale (older than 7 days).
 */
export async function maybeReanalyze(agent: Agent): Promise<boolean> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
    return false;
  }

  const analysis = await getAnalysis(agent.id);

  // Run if: no analysis exists, or analysis is older than 7 days
  if (analysis) {
    const ageMs = Date.now() - new Date(analysis.analyzedAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (ageMs < sevenDays) return false;
  }

  try {
    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const newAnalysis = await analyzeAccount(keys, agent.xUserId, agent.id);
    await saveAnalysis(agent.id, newAnalysis);

    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: `Auto re-analyzed account: ${newAnalysis.tweetCount} tweets, ${newAnalysis.viralTweets.length} viral, ${newAnalysis.followingProfile.totalFollowing} following`,
      format: 'system',
      topic: 'analysis',
      postedAt: new Date().toISOString(),
      source: 'cron',
      action: 'mentions_refreshed',
      reason: 'Weekly re-analysis',
    });

    return true;
  } catch {
    return false;
  }
}
