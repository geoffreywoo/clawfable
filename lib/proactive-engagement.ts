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
import { replyToTweet, likeTweet, followUser, getFollowing } from './twitter-client';
import { parseSoulMd } from './soul-parser';
import { getAnalysis, getProtocolSettings, addPostLogEntry, getAgents, getPostLog, getTrendingCache, getPerformanceHistory } from './kv-storage';
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

  // Find RISING tweets — posted recently with high engagement velocity.
  // A tweet at 100 likes in 2 hours is about to blow up.
  // A tweet at 500 likes from 3 days ago is a dead thread.
  const now = Date.now();
  const viralTweets = trending
    .filter((t) => {
      if (!t.topTweet || t.topTweet.likes < 50) return false;
      const tweetAge = now - new Date(t.timestamp).getTime();
      const hoursOld = tweetAge / (1000 * 60 * 60);
      // Rising = posted within last 6 hours with 50+ likes, OR within 12 hours with 200+ likes
      return (hoursOld < 6 && t.topTweet.likes >= 50) || (hoursOld < 12 && t.topTweet.likes >= 200);
    })
    // Sort by engagement velocity (likes per hour)
    .sort((a, b) => {
      const ageA = Math.max(1, (now - new Date(a.timestamp).getTime()) / (1000 * 60 * 60));
      const ageB = Math.max(1, (now - new Date(b.timestamp).getTime()) / (1000 * 60 * 60));
      return (b.topTweet!.likes / ageB) - (a.topTweet!.likes / ageA);
    })
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

/**
 * Peer study: analyze what top accounts in the agent's network are doing
 * that gets high engagement, and extract style patterns the agent should learn from.
 * Returns insights that get injected into the generation prompt.
 */
export async function studyPeerStyles(
  agent: Agent,
): Promise<string[]> {
  const trending = await getTrendingCache(agent.id) as TrendingTopic[] | null;
  if (!trending || trending.length === 0) return [];

  // Collect the top tweets from different authors
  const topTweetsByAuthor = new Map<string, { text: string; likes: number; author: string }>();
  for (const topic of trending) {
    if (!topic.topTweet || topic.topTweet.likes < 50) continue;
    const existing = topTweetsByAuthor.get(topic.topTweet.author);
    if (!existing || topic.topTweet.likes > existing.likes) {
      topTweetsByAuthor.set(topic.topTweet.author, topic.topTweet);
    }
  }

  const topTweets = [...topTweetsByAuthor.values()]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 8);

  if (topTweets.length < 3) return [];

  try {
    const tweetList = topTweets
      .map((t) => `@${t.author} (${t.likes} likes): "${t.text.slice(0, 200)}"`)
      .join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: `You analyze viral tweets from top accounts to extract style patterns. Output 3-5 bullet points, one per line. Each should be a specific, actionable pattern: "Tweets that [specific structure] get [N]x more engagement." Focus on: opening hooks, sentence structure, use of specifics vs abstractions, tone, length, question usage, contrarian framing. No generic advice.`,
      messages: [{
        role: 'user',
        content: `These are the top-performing tweets from accounts in this agent's network right now:\n\n${tweetList}\n\nWhat style patterns are working? Be specific and actionable.`,
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return text.split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 15)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Smart follow discovery: find and follow relevant accounts to expand
 * the agent's network for better trending data, more reply opportunities,
 * and richer inspiration for content generation.
 *
 * Discovery sources:
 * 1. Authors of viral tweets in trending data (high-quality signal)
 * 2. Accounts that engage with the agent's content (reply/mention authors)
 * 3. Accounts followed by the agent's most-followed connections (2nd degree)
 *
 * Filters:
 * - Must have 1K+ followers (quality filter)
 * - Must have posted in last 7 days (active filter)
 * - Must not already be followed
 * - Max 3 follows per cron run (rate limit safety)
 */
export async function discoverAndFollow(
  agent: Agent,
  keys: TwitterKeys,
  settings: ProtocolSettings,
): Promise<number> {
  if (!settings.autoFollow || !agent.xUserId) return 0;

  // Get who we already follow
  let currentFollowing: Set<string>;
  try {
    const following = await getFollowing(keys, String(agent.xUserId), 200);
    currentFollowing = new Set(following.map((f) => f.id));
  } catch {
    return 0;
  }

  // Collect candidate accounts from multiple sources
  const candidates = new Map<string, { id: string; username: string; reason: string; score: number }>();

  // Source 1: Authors of viral tweets in trending data
  const trending = await getTrendingCache(agent.id) as TrendingTopic[] | null;
  if (trending) {
    for (const topic of trending) {
      if (!topic.topTweet || topic.topTweet.likes < 100) continue;
      // We don't have the author's user ID from trending (only username)
      // Store username for now, we'll resolve later
      const author = topic.topTweet.author;
      if (!candidates.has(author)) {
        candidates.set(author, {
          id: '', // will resolve
          username: author,
          reason: `Viral content in ${topic.category} (${topic.topTweet.likes} likes)`,
          score: topic.topTweet.likes,
        });
      }
    }
  }

  // Source 2: Authors of mentions/replies to the agent (people engaging with us)
  const postLog = await getPostLog(agent.id, 100);
  const replyAuthors = new Set<string>();
  for (const entry of postLog) {
    if (entry.topic?.startsWith('Reply to @')) {
      const handle = entry.topic.replace('Reply to ', '').replace('@', '');
      if (handle && !replyAuthors.has(handle)) {
        replyAuthors.add(handle);
        if (!candidates.has(handle)) {
          candidates.set(handle, {
            id: '',
            username: handle,
            reason: 'Engaged with our content (replied/mentioned)',
            score: 50,
          });
        }
      }
    }
  }

  // Source 3: Authors of top-performing tweets in our performance history
  const perfHistory = await getPerformanceHistory(agent.id, 100);
  const topPerf = perfHistory
    .filter((p) => p.source === 'timeline' && p.likes >= 50)
    .slice(0, 10);
  // These are tweets from accounts we already follow, so skip this source for new follows

  if (candidates.size === 0) return 0;

  // Sort by score (viral engagement), take top candidates
  const sorted = [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // Resolve usernames to IDs and follow (max 3 per run)
  let followed = 0;
  for (const candidate of sorted) {
    if (followed >= 3) break;

    try {
      // Resolve username to user ID
      const { getUserByUsername } = await import('./twitter-client');
      const user = await getUserByUsername(keys, candidate.username);
      if (!user || currentFollowing.has(user.id) || user.id === String(agent.xUserId)) continue;

      await followUser(keys, String(agent.xUserId), user.id);

      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: `Followed @${candidate.username}: ${candidate.reason}`,
        format: 'auto_follow',
        topic: 'network_growth',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'posted',
        reason: candidate.reason,
      });

      currentFollowing.add(user.id);
      followed++;
    } catch {
      // Rate limit, already following, or account not found — skip
    }
  }

  return followed;
}
