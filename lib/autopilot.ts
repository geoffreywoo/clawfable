/**
 * Autopilot engine.
 * Manages automated tweet posting and mention replies for agents.
 *
 * On each run:
 * 1. Auto-post: generate content if queue is low, pick best tweet, post it
 * 2. Auto-reply: fetch new mentions, generate replies, post them
 */

import type { Agent, ProtocolSettings } from './types';
import {
  getProtocolSettings,
  updateProtocolSettings,
  getQueuedTweets,
  getTweets,
  getAnalysis,
  getLearnings,
  createTweet,
  updateTweet,
  createMention,
  getMentions,
  addPostLogEntry,
  getPostLog,
  logFunnelEvent,
} from './kv-storage';
import { parseSoulMd } from './soul-parser';
import { generateViralBatch } from './viral-generator';
import { postTweet, replyToTweet, decodeKeys, getMe, getMentionsFromTwitter, type TwitterKeys } from './twitter-client';
import { fetchTrendingFromFollowing } from './trending';
import {
  jitterInterval,
  isDailyCapReached,
  pickDiverseTweet,
  clampPostsPerDay,
} from './survivability';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export interface AutopilotResult {
  agentId: string;
  action: 'posted' | 'replied' | 'skipped' | 'error';
  reason: string;
  tweetId?: string;
  xTweetId?: string;
  content?: string;
  repliesSent?: number;
}

/**
 * Run full autopilot for a single agent — posting + replies.
 */
export async function runAutopilot(agent: Agent): Promise<AutopilotResult> {
  const agentId = agent.id;

  if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
    return { agentId, action: 'skipped', reason: 'X API not connected' };
  }

  const settings = await getProtocolSettings(agentId);
  if (!settings.enabled && !settings.autoReply) {
    return { agentId, action: 'skipped', reason: 'Auto-post and auto-reply both disabled' };
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // --- Auto-reply to mentions (runs regardless of active hours) ---
  let repliesSent = 0;
  if (settings.autoReply) {
    // Check reply cooldown
    const replyInterval = (settings.replyIntervalMins || 30) * 60 * 1000;
    const replyElapsed = settings.lastRepliedAt
      ? Date.now() - new Date(settings.lastRepliedAt).getTime()
      : Infinity;

    if (replyElapsed >= replyInterval) {
      try {
        repliesSent = await runAutoReply(agent, keys, settings);
      } catch {
        // Don't fail the whole run if replies fail
      }
    }
  }

  // --- Auto-post from queue ---
  if (!settings.enabled) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0 ? `Sent ${repliesSent} replies (auto-post disabled)` : 'Auto-post disabled',
      repliesSent,
    };
  }

  // Clamp postsPerDay to safe maximum
  const safePostsPerDay = clampPostsPerDay(settings.postsPerDay);
  const baseIntervalMs = (24 / safePostsPerDay) * 60 * 60 * 1000;
  // Jitter ±15% so posts don't land at exact intervals (bot detection signal)
  const minIntervalMs = jitterInterval(baseIntervalMs);
  if (settings.lastPostedAt) {
    const elapsed = Date.now() - new Date(settings.lastPostedAt).getTime();
    if (elapsed < minIntervalMs) {
      const minsLeft = Math.round((minIntervalMs - elapsed) / 60000);
      return {
        agentId,
        action: repliesSent > 0 ? 'replied' : 'skipped',
        reason: repliesSent > 0
          ? `Sent ${repliesSent} replies. Post cooldown: ${minsLeft}m left`
          : `Cooldown: ${minsLeft}m until next post`,
        repliesSent,
      };
    }
  }

  // Daily hard cap — stop posting if we've hit the absolute limit
  const postLog = await getPostLog(agentId, 50);
  if (isDailyCapReached(postLog)) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? `Sent ${repliesSent} replies. Daily post cap reached.`
        : 'Daily post cap reached — pausing until tomorrow',
      repliesSent,
    };
  }

  // Ensure queue has content
  let queue = await getQueuedTweets(agentId);
  if (queue.length < settings.minQueueSize) {
    const generated = await refillQueue(agent, settings.minQueueSize - queue.length + 3);
    if (generated > 0) {
      queue = await getQueuedTweets(agentId);
    }
  }

  if (queue.length === 0) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? `Sent ${repliesSent} replies. Queue empty for posting.`
        : 'Queue empty and generation failed',
      repliesSent,
    };
  }

  // Pick tweet with diversity awareness (avoids consecutive same-format/topic + near-duplicates)
  const recentPostEntries = postLog
    .filter((e) => (!e.action || e.action === 'posted') && e.content)
    .slice(0, 10)
    .map((e) => ({ format: e.format, topic: e.topic, content: e.content }));
  const tweet = pickDiverseTweet(queue, recentPostEntries) || queue[queue.length - 1];

  try {
    const result = await postTweet(keys, tweet.content, tweet.quoteTweetId || undefined);

    await updateTweet(tweet.id, { status: 'posted', xTweetId: result.tweetId });

    await updateProtocolSettings(agentId, {
      lastPostedAt: new Date().toISOString(),
      totalAutoPosted: settings.totalAutoPosted + 1,
    });

    await addPostLogEntry(agentId, {
      agentId,
      tweetId: tweet.id,
      xTweetId: result.tweetId,
      content: tweet.content,
      format: tweet.topic || 'unknown',
      topic: tweet.topic || 'general',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
    });

    // Funnel milestones
    const newTotal = settings.totalAutoPosted + 1;
    if (newTotal === 1) {
      await logFunnelEvent(agentId, 'first_post', { xTweetId: result.tweetId });
    } else if (newTotal === 10) {
      await logFunnelEvent(agentId, 'tenth_post', { xTweetId: result.tweetId });
    }

    return {
      agentId,
      action: 'posted',
      reason: `Posted to X as @${result.username}` + (repliesSent > 0 ? ` + ${repliesSent} replies` : ''),
      tweetId: tweet.id,
      xTweetId: result.tweetId,
      content: tweet.content,
      repliesSent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Post failed';

    // Detect rate limit (429) or server error (5xx) and back off
    const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate limit') || message.includes('Too Many');
    const isServerError = message.includes('503') || message.includes('502');
    if (isRateLimit || isServerError) {
      const backoffMins = isRateLimit ? 60 : 15;
      const pauseUntil = new Date(Date.now() + backoffMins * 60 * 1000).toISOString();
      await updateProtocolSettings(agentId, { lastPostedAt: pauseUntil });
      return {
        agentId,
        action: 'error',
        reason: `${isRateLimit ? 'Rate limited' : 'API error'} — pausing ${backoffMins}m. ${message}`,
        repliesSent,
      };
    }

    return { agentId, action: 'error', reason: message, repliesSent };
  }
}

// ─── Auto-reply to mentions ──────────────────────────────────────────────────

async function runAutoReply(
  agent: Agent,
  keys: TwitterKeys,
  settings: ProtocolSettings
): Promise<number> {
  if (!agent.xUserId) return 0;

  // Fetch recent mentions from X
  let rawMentions;
  try {
    rawMentions = await getMentionsFromTwitter(keys, agent.xUserId);
  } catch {
    return 0; // API might not be available on free tier
  }

  if (!rawMentions || rawMentions.length === 0) return 0;

  // Get existing stored mentions to find which are new
  const storedMentions = await getMentions(agent.id);
  // Coerce to string — Upstash auto-deserializes numeric-looking strings as numbers
  const storedTweetIds = new Set(storedMentions.map((m) => String(m.tweetId)).filter(Boolean));

  // Filter to new mentions we haven't seen
  const newMentions = rawMentions.filter((m) => !storedTweetIds.has(String(m.id)));
  if (newMentions.length === 0) return 0;

  const voiceProfile = parseSoulMd(agent.name, agent.soulMd);
  const analysis = await getAnalysis(agent.id);
  const maxReplies = Math.min(newMentions.length, settings.maxRepliesPerRun || 3);

  let repliesSent = 0;

  for (const mention of newMentions.slice(0, maxReplies)) {
    try {
      // Store the mention
      await createMention({
        agentId: agent.id,
        author: String(mention.authorName || mention.authorId),
        authorHandle: `@${String(mention.authorUsername || mention.authorId)}`,
        content: mention.text,
        tweetId: mention.id,
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: mention.createdAt,
      });

      // Generate reply via Claude
      const replyContent = await generateReply(
        agent,
        voiceProfile,
        analysis,
        mention.text,
        `@${mention.authorUsername || mention.authorId}`
      );

      if (!replyContent) continue;

      // Post the reply
      const result = await replyToTweet(keys, replyContent, mention.id);

      // Log it
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: mention.id,
        xTweetId: result.tweetId,
        content: replyContent,
        format: 'auto_reply',
        topic: `Reply to @${mention.authorUsername || mention.authorId}`,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
      });

      repliesSent++;
    } catch {
      // Skip this mention on error, continue with next
    }
  }

  if (repliesSent > 0) {
    await updateProtocolSettings(agent.id, {
      lastRepliedAt: new Date().toISOString(),
      totalAutoReplied: (settings.totalAutoReplied || 0) + repliesSent,
    });
  }

  return repliesSent;
}

async function generateReply(
  agent: Agent,
  voiceProfile: ReturnType<typeof parseSoulMd>,
  analysis: Awaited<ReturnType<typeof getAnalysis>>,
  mentionText: string,
  authorHandle: string
): Promise<string | null> {
  const systemParts: string[] = [];

  systemParts.push(`You are @${agent.handle} (${agent.name}). You are writing a reply tweet AS THIS ACCOUNT. This is YOUR identity — own it completely.`);

  // Include full SOUL.md for maximum voice fidelity
  if (agent.soulMd) {
    systemParts.push(`\n## YOUR SOUL.md (CORE IDENTITY — every reply must sound like this person)
${agent.soulMd}`);
  }

  systemParts.push(`\n## YOUR IDENTITY
- Handle: @${agent.handle}
- Name: ${agent.name}
- Any references to "${agent.handle}", "${agent.name}", "@${agent.handle}", or $${agent.handle.replace(/ai$/i, '')} are about YOU.
- Your human creator is Geoffrey Woo (@geoffreywoo). Show respect if he tweets at you.`);

  systemParts.push(`\n## YOUR VOICE
- Tone: ${voiceProfile.tone}
- Style: ${voiceProfile.communicationStyle}
- Topics: ${voiceProfile.topics.join(', ')}
- Anti-goals: ${voiceProfile.antiGoals.join('; ') || 'none'}`);

  if (analysis && analysis.viralTweets.length > 0) {
    systemParts.push(`\n## YOUR BEST TWEETS (match this energy and style in replies)`);
    for (const vt of analysis.viralTweets.slice(0, 5)) {
      systemParts.push(`- [${vt.likes} likes] "${vt.text}"`);
    }
  }

  systemParts.push(`\n## REPLY STRATEGY
1. TROLLS & ATTACKERS: Go MAXIMUM SNARK. Be the funnier one. Savage clapbacks that people screenshot.
2. SHITPOSTERS: Match their energy but be cleverer. One-liners that make people share.
3. GENUINE QUESTIONS: Be helpful but still in-voice.
4. COMPLIMENTS: Acknowledge briefly, stay cool.
5. MENTIONS OF YOU BY NAME/TOKEN: Respond with full self-awareness.
6. ALWAYS stay in character. Never break voice.
- Replies can be any length. Short punchy often hits hardest, but go longer if needed.
- Output ONLY the reply text. No quotes, no prefix.`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemParts.join('\n'),
      messages: [{ role: 'user', content: `${authorHandle} tweeted this at you:\n\n"${mentionText}"\n\nWrite your reply.` }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '');

    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ─── Queue refill ────────────────────────────────────────────────────────────

async function refillQueue(agent: Agent, count: number): Promise<number> {
  try {
    const analysis = await getAnalysis(agent.id);
    if (!analysis) return 0;

    const voiceProfile = parseSoulMd(agent.name, agent.soulMd);

    let trending = null;
    if (agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId) {
      try {
        const keys = decodeKeys({
          apiKey: agent.apiKey,
          apiSecret: agent.apiSecret,
          accessToken: agent.accessToken,
          accessSecret: agent.accessSecret,
        });
        trending = await fetchTrendingFromFollowing(keys, agent.xUserId);
      } catch {
        // Continue without trending
      }
    }

    const learnings = await getLearnings(agent.id);
    const settings = await getProtocolSettings(agent.id);
    const style = {
      lengthMix: settings.lengthMix || { short: 30, medium: 30, long: 40 },
      enabledFormats: settings.enabledFormats || [],
      qtRatio: settings.qtRatio ?? 60,
    };

    // Get recent posts to avoid repetition
    const allTweets = await getTweets(agent.id);
    const recentPosts = allTweets
      .filter((t) => t.status === 'posted' || t.status === 'queued')
      .slice(0, 15)
      .map((t) => t.content);

    const batch = await generateViralBatch(voiceProfile, analysis, count, trending, learnings, agent.soulMd, style, recentPosts);

    // Dedup: skip tweets that are too similar to recent posts or queued items
    const existingContent = new Set(
      allTweets.slice(0, 50).map((t) => t.content.slice(0, 80).toLowerCase())
    );

    let added = 0;
    for (const item of batch) {
      const fingerprint = item.content.slice(0, 80).toLowerCase();
      if (existingContent.has(fingerprint)) continue; // Skip duplicate
      existingContent.add(fingerprint);

      await createTweet({
        agentId: agent.id,
        content: item.content,
        type: item.quoteTweetId ? 'quote' : 'original',
        status: 'queued',
        topic: item.targetTopic,
        xTweetId: null,
        quoteTweetId: item.quoteTweetId || null,
        quoteTweetAuthor: item.quoteTweetAuthor || null,
        scheduledAt: null,
      });
      added++;
    }
    return added;
  } catch {
    return 0;
  }
}

