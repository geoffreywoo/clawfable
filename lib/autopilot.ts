/**
 * Autopilot engine.
 * Manages automated tweet generation and posting for agents.
 *
 * On each run:
 * 1. Check if the agent should post now (enabled, within active hours, not too soon)
 * 2. If queue is low, generate new content from analysis + soul
 * 3. Pick the best tweet from queue
 * 4. Post it to X
 * 5. Log the result
 */

import type { Agent, ProtocolSettings, AccountAnalysis } from './types';
import {
  getProtocolSettings,
  updateProtocolSettings,
  getQueuedTweets,
  getAnalysis,
  createTweet,
  updateTweet,
  addPostLogEntry,
} from './kv-storage';
import { parseSoulMd } from './soul-parser';
import { generateViralBatch } from './viral-generator';
import { postTweet, decodeKeys } from './twitter-client';
import { fetchTrendingFromFollowing } from './trending';

export interface AutopilotResult {
  agentId: string;
  action: 'posted' | 'skipped' | 'error';
  reason: string;
  tweetId?: string;
  xTweetId?: string;
  content?: string;
}

/**
 * Run autopilot for a single agent. Returns what happened.
 */
export async function runAutopilot(agent: Agent): Promise<AutopilotResult> {
  const agentId = agent.id;

  // Check connection
  if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
    return { agentId, action: 'skipped', reason: 'X API not connected' };
  }

  // Check protocol settings
  const settings = await getProtocolSettings(agentId);
  if (!settings.enabled) {
    return { agentId, action: 'skipped', reason: 'Autopilot disabled' };
  }

  // Check active hours
  const nowUtc = new Date().getUTCHours();
  if (!isWithinActiveHours(nowUtc, settings.activeHoursStart, settings.activeHoursEnd)) {
    return { agentId, action: 'skipped', reason: `Outside active hours (${settings.activeHoursStart}-${settings.activeHoursEnd} UTC)` };
  }

  // Check cooldown — don't post more often than postsPerDay allows
  const minIntervalMs = (24 / settings.postsPerDay) * 60 * 60 * 1000;
  if (settings.lastPostedAt) {
    const elapsed = Date.now() - new Date(settings.lastPostedAt).getTime();
    if (elapsed < minIntervalMs) {
      const minsLeft = Math.round((minIntervalMs - elapsed) / 60000);
      return { agentId, action: 'skipped', reason: `Cooldown: ${minsLeft}m until next post` };
    }
  }

  // Ensure queue has content — auto-generate if needed
  let queue = await getQueuedTweets(agentId);
  if (queue.length < settings.minQueueSize) {
    const generated = await refillQueue(agent, settings.minQueueSize - queue.length + 3);
    if (generated > 0) {
      queue = await getQueuedTweets(agentId);
    }
  }

  if (queue.length === 0) {
    return { agentId, action: 'skipped', reason: 'Queue empty and generation failed' };
  }

  // Pick the first queued tweet (oldest = most reviewed)
  const tweet = queue[queue.length - 1]; // oldest first

  // Post it
  try {
    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const result = await postTweet(keys, tweet.content, tweet.quoteTweetId || undefined);

    // Update tweet status
    await updateTweet(tweet.id, { status: 'posted', xTweetId: result.tweetId });

    // Update protocol settings
    await updateProtocolSettings(agentId, {
      lastPostedAt: new Date().toISOString(),
      totalAutoPosted: settings.totalAutoPosted + 1,
    });

    // Log it
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
      reason: `Posted to X as @${result.username}`,
      tweetId: tweet.id,
      xTweetId: result.tweetId,
      content: tweet.content,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Post failed';
    return { agentId, action: 'error', reason: message };
  }
}

/**
 * Generate tweets and add them to the queue.
 */
async function refillQueue(agent: Agent, count: number): Promise<number> {
  try {
    const analysis = await getAnalysis(agent.id);
    if (!analysis) return 0;

    const voiceProfile = parseSoulMd(agent.name, agent.soulMd);

    // Fetch trending context if connected
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
  // Wraps midnight (e.g., 22-6)
  return currentHour >= start || currentHour < end;
}
