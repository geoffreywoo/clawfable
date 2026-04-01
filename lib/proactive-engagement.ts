/**
 * Proactive engagement engine.
 * Instead of waiting for mentions, the agent actively:
 * 1. Replies to viral tweets in its network (highest growth lever on X)
 * 2. Likes relevant tweets to build relationships
 * 3. Shouts out other Clawfable agents (cross-promotion)
 */

import type { Agent, ProtocolSettings } from './types';
import type { TrendingTopic } from './trending';
import type { TwitterKeys } from './twitter-client';
import { replyToTweet, likeTweet } from './twitter-client';
import { parseSoulMd } from './soul-parser';
import { getAnalysis, getProtocolSettings, addPostLogEntry, getAgents, getPostLog, getTrendingCache } from './kv-storage';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

/**
 * Reply to viral tweets in the agent's network.
 * This is the #1 growth strategy on X: show up in viral threads
 * where thousands of people are already looking.
 */
export async function replyToViralTweets(
  agent: Agent,
  keys: TwitterKeys,
  settings: ProtocolSettings,
): Promise<number> {
  if (!settings.proactiveReplies) return 0;

  // Get cached trending data (already fetched by refillQueue, 4h TTL)
  const trending = await getTrendingCache(agent.id) as TrendingTopic[] | null;
  if (!trending || trending.length === 0) return 0;

  // Find viral tweets worth replying to (500+ likes, in agent's topic areas)
  const viralTweets = trending
    .filter((t) => t.topTweet && t.topTweet.likes >= 100)
    .sort((a, b) => (b.topTweet?.likes || 0) - (a.topTweet?.likes || 0))
    .slice(0, 5);

  if (viralTweets.length === 0) return 0;

  // Check which tweets we've already replied to
  const postLog = await getPostLog(agent.id, 100);
  const repliedToIds = new Set(
    postLog
      .filter((e) => e.format === 'proactive_reply')
      .map((e) => e.tweetId)
  );

  const voiceProfile = parseSoulMd(agent.name, agent.soulMd);
  const analysis = await getAnalysis(agent.id);
  let repliesSent = 0;

  for (const topic of viralTweets) {
    if (repliesSent >= 2) break; // Max 2 proactive replies per run
    if (!topic.topTweet || repliedToIds.has(topic.topTweet.id)) continue;

    try {
      const replyContent = await generateViralReply(
        agent,
        voiceProfile,
        analysis,
        topic.topTweet.text,
        topic.topTweet.author,
        topic.category,
      );

      if (!replyContent) continue;

      const result = await replyToTweet(keys, replyContent, topic.topTweet.id);

      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: topic.topTweet.id,
        xTweetId: result.tweetId,
        content: replyContent,
        format: 'proactive_reply',
        topic: topic.category,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'posted',
        reason: `Proactive reply to @${topic.topTweet.author} (${topic.topTweet.likes} likes)`,
      });

      repliesSent++;
    } catch {
      // Skip this tweet on error
    }
  }

  return repliesSent;
}

async function generateViralReply(
  agent: Agent,
  voiceProfile: ReturnType<typeof parseSoulMd>,
  analysis: Awaited<ReturnType<typeof getAnalysis>>,
  tweetText: string,
  tweetAuthor: string,
  category: string,
): Promise<string | null> {
  try {
    const systemParts = [
      `You are @${agent.handle} (${agent.name}). You are writing a reply to a VIRAL tweet to get maximum visibility.`,
      `\nYour voice: ${voiceProfile.tone}. Style: ${voiceProfile.communicationStyle.slice(0, 300)}`,
    ];

    if (agent.soulMd) {
      systemParts.push(`\n## YOUR SOUL.md\n${agent.soulMd.slice(0, 1500)}`);
    }

    if (analysis?.viralTweets?.length) {
      systemParts.push(`\nYour best tweets for reference:`);
      for (const vt of analysis.viralTweets.slice(0, 3)) {
        systemParts.push(`- [${vt.likes} likes] "${vt.text.slice(0, 100)}"`);
      }
    }

    systemParts.push(`\n## STRATEGY FOR VIRAL REPLIES
- This tweet already has high engagement. Your reply will be seen by THOUSANDS.
- Add genuine value: a unique angle, insider knowledge, a contrarian take, or a sharp observation.
- Be CONCISE. Under 200 chars hits hardest in reply threads.
- Don't suck up. Don't say "great point". Add something NEW.
- Be opinionated. Bland agreement gets scrolled past.
- If you disagree, disagree smartly with evidence.
- Match the energy of the original but bring YOUR voice.
- NEVER include links to clawfable.com or self-promote. Just be good.
- Output ONLY the reply text. No quotes, no prefix.`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: systemParts.join('\n'),
      messages: [{
        role: 'user',
        content: `@${tweetAuthor} posted this viral tweet (topic: ${category}):\n\n"${tweetText.slice(0, 500)}"\n\nWrite your reply. Be sharp, be you, add value.`,
      }],
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

/**
 * Like relevant tweets in the agent's network.
 * Free engagement that builds relationships without posting.
 */
export async function likeNetworkTweets(
  agent: Agent,
  keys: TwitterKeys,
  settings: ProtocolSettings,
): Promise<number> {
  if (!settings.proactiveLikes || !agent.xUserId) return 0;

  const trending = await getTrendingCache(agent.id) as TrendingTopic[] | null;
  if (!trending || trending.length === 0) return 0;

  // Like the top tweet from each trending topic (max 5 likes per run)
  let liked = 0;
  for (const topic of trending.slice(0, 5)) {
    if (!topic.topTweet || liked >= 5) break;
    try {
      await likeTweet(keys, String(agent.xUserId), topic.topTweet.id);
      liked++;
    } catch {
      // Rate limit or already liked, skip
    }
  }

  return liked;
}

/**
 * Shout out other Clawfable agents (cross-promotion).
 * When enabled, occasionally generates a tweet mentioning another
 * Clawfable agent's content or achievements.
 */
export async function generateAgentShoutout(
  agent: Agent,
): Promise<{ content: string; targetHandle: string } | null> {
  try {
    // Find other public Clawfable agents
    const allAgents = await getAgents();
    const otherAgents = allAgents.filter(
      (a) => a.id !== agent.id && a.setupStep === 'ready' && a.soulPublic !== 0 && a.handle !== agent.handle
    );

    if (otherAgents.length === 0) return null;

    // Pick a random agent to shout out
    const target = otherAgents[Math.floor(Math.random() * otherAgents.length)];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: `You are @${agent.handle}. Write a brief, natural shoutout tweet mentioning @${target.handle} (${target.name}). The shoutout should feel organic, not forced. Reference their work or perspective. Stay in your voice. Keep it under 200 chars. No hashtags. Output ONLY the tweet text.`,
      messages: [{
        role: 'user',
        content: `Write a shoutout for @${target.handle}. Their soul summary: "${target.soulSummary || target.name}". Make it feel natural.`,
      }],
    });

    const content = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '');

    return content.length > 0 ? { content, targetHandle: target.handle } : null;
  } catch {
    return null;
  }
}
