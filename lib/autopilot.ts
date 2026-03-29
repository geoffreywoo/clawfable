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
  getAnalysis,
  createTweet,
  updateTweet,
  createMention,
  getMentions,
  addPostLogEntry,
} from './kv-storage';
import { parseSoulMd } from './soul-parser';
import { generateViralBatch } from './viral-generator';
import { postTweet, replyToTweet, decodeKeys, getMe, getMentionsFromTwitter, type TwitterKeys } from './twitter-client';
import { fetchTrendingFromFollowing } from './trending';
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
  if (!settings.enabled) {
    return { agentId, action: 'skipped', reason: 'Autopilot disabled' };
  }

  const nowUtc = new Date().getUTCHours();
  if (!isWithinActiveHours(nowUtc, settings.activeHoursStart, settings.activeHoursEnd)) {
    return { agentId, action: 'skipped', reason: `Outside active hours (${settings.activeHoursStart}-${settings.activeHoursEnd} UTC)` };
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // --- Auto-reply to mentions ---
  let repliesSent = 0;
  if (settings.autoReply) {
    try {
      repliesSent = await runAutoReply(agent, keys, settings);
    } catch {
      // Don't fail the whole run if replies fail
    }
  }

  // --- Auto-post from queue ---
  const minIntervalMs = (24 / settings.postsPerDay) * 60 * 60 * 1000;
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

  const tweet = queue[queue.length - 1]; // oldest first

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
  const storedTweetIds = new Set(storedMentions.map((m) => m.tweetId).filter(Boolean));

  // Filter to new mentions we haven't seen
  const newMentions = rawMentions.filter((m) => !storedTweetIds.has(m.id));
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

  systemParts.push(`You are @${agent.handle} (${agent.name}). You are writing a reply tweet AS THIS ACCOUNT.`);

  systemParts.push(`\n## YOUR IDENTITY
- Handle: @${agent.handle}
- Name: ${agent.name}
- References to "${agent.handle}", "${agent.name}", "@${agent.handle}", or $${agent.handle.replace(/ai$/i, '')} are about YOU.
- Your human creator is Geoffrey Woo (@geoffreywoo).`);

  systemParts.push(`\n## YOUR VOICE
- Tone: ${voiceProfile.tone}
- Style: ${voiceProfile.communicationStyle}
- Topics: ${voiceProfile.topics.join(', ')}`);

  if (analysis && analysis.viralTweets.length > 0) {
    systemParts.push(`\n## YOUR STYLE (match this energy)`);
    for (const vt of analysis.viralTweets.slice(0, 3)) {
      systemParts.push(`- [${vt.likes} likes] "${vt.text}"`);
    }
  }

  systemParts.push(`\n## REPLY RULES
- TROLLS/ATTACKERS: Maximum snark. Be the funnier one. Savage clapbacks.
- GENUINE QUESTIONS: Helpful but in-voice.
- COMPLIMENTS: Acknowledge briefly, stay cool.
- Replies can be any length. Short and punchy often hits hardest, but go longer if needed. X supports up to 4000 chars.
- Output ONLY the reply text.`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
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

    const batch = await generateViralBatch(voiceProfile, analysis, count, trending);

    let added = 0;
    for (const item of batch) {
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

function isWithinActiveHours(currentHour: number, start: number, end: number): boolean {
  if (start <= end) {
    return currentHour >= start && currentHour < end;
  }
  return currentHour >= start || currentHour < end;
}
