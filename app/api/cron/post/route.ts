import { NextRequest, NextResponse } from 'next/server';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { getAgents, getProtocolSettings, getAgent, createMention, getMentions, addPostLogEntry, getLearnings, getPerformanceHistory, resetReadCache, getAgentOwnerId, getUser, updateProtocolSettings, invalidateAgentConnection, setAutopilotHealth } from '@/lib/kv-storage';
import { runAutopilot } from '@/lib/autopilot';
import type { AutopilotResult } from '@/lib/autopilot';
import { refreshAutopilotHealth, runAutopilotWatchdog } from '@/lib/autopilot-health';
import { decodeKeys, getMentionsFromTwitter } from '@/lib/twitter-client';
import { maybeEvolveSoul } from '@/lib/soul-evolution';
import { replyToViralTweets, likeNetworkTweets, discoverAndFollow } from '@/lib/proactive-engagement';
import { checkPerformance, buildLearnings, autoAdjustSettings, maybeReanalyze } from '@/lib/performance';
import { formatActionError, isInvalidTwitterCredentialError } from '@/lib/twitter-debug';
import { getBillingSummary } from '@/lib/billing';

// GET /api/cron/post — called by Vercel Cron every 10 minutes
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authBearer = request.headers.get('authorization');
    if (authBearer !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Fresh cache per cron tick — request-scoped memoization (cuts duplicate KV reads).
  resetReadCache();

  try {
    const agents = await getAgents();
    const autopilotResults: AutopilotResult[] = [];
    let mentionsRefreshed = 0;
    let performanceTracked = 0;

    for (const agent of agents) {
      const isConnected = agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId;

      // Early exit: if agent isn't connected AND has no autopilot config, skip everything.
      // Saves KV commands on dormant or unconfigured agents.
      const settings = await getProtocolSettings(agent.id);
      const ownerId = await getAgentOwnerId(agent.id);
      const owner = ownerId
        ? await getUser(ownerId)
        : agent.xUserId
          ? await getUser(String(agent.xUserId))
          : null;
      const billing = owner ? getBillingSummary(owner, await getAccessibleAgentCount(owner)) : null;
      const automationAllowed = billing ? billing.canUseAutopilot : true;

      if (!automationAllowed && (
        settings.enabled
        || settings.autoReply
        || settings.proactiveReplies
        || settings.proactiveLikes
        || settings.autoFollow
        || settings.agentShoutouts
      )) {
        await updateProtocolSettings(agent.id, {
          enabled: false,
          autoReply: false,
          proactiveReplies: false,
          proactiveLikes: false,
          autoFollow: false,
          agentShoutouts: false,
        });
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'billing_lock',
          topic: 'billing',
          postedAt: new Date().toISOString(),
          source: 'cron',
          action: 'skipped',
          reason: `Automation disabled on ${billing?.label || 'free'} plan.`,
        });
        await setAutopilotHealth({
          agentId: agent.id,
          status: 'blocked',
          checkedAt: new Date().toISOString(),
          reason: `Automation disabled on ${billing?.label || 'free'} plan.`,
          details: ['Upgrade or change billing before autopilot can run again.'],
          lastPostedAt: settings.lastPostedAt,
          expectedPostBy: null,
          minutesOverdue: 0,
          cadenceHours: 0,
          queueDepth: 0,
          postableQueueDepth: 0,
          staleLowConfidenceDepth: 0,
          maxConfidence: null,
          externalBlocker: 'billing',
          selfHealAttemptedAt: null,
          selfHealAction: null,
        });
        continue;
      }

      if (!isConnected && !settings.enabled && !settings.autoReply) {
        continue;
      }

      if (isConnected) {
        // Refresh mentions
        try {
          const refreshed = await refreshMentions(agent.id);
          mentionsRefreshed += refreshed;
          if (refreshed > 0) {
            await addPostLogEntry(agent.id, {
              agentId: agent.id,
              tweetId: '',
              xTweetId: '',
              content: `Fetched ${refreshed} new mention${refreshed !== 1 ? 's' : ''} from X`,
              format: 'cron',
              topic: 'mentions',
              postedAt: new Date().toISOString(),
              source: 'cron',
              action: 'mentions_refreshed',
              reason: `${refreshed} new`,
            });
          }
        } catch (err) {
          console.error(`[cron] mentions refresh failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
          await addPostLogEntry(agent.id, {
            agentId: agent.id,
            tweetId: '',
            xTweetId: '',
            content: '',
            format: 'cron_mentions_error',
            topic: 'mentions',
            postedAt: new Date().toISOString(),
            source: 'cron',
            action: 'error',
            reason: formatActionError(err, 'refresh_mentions', {
              handle: `@${agent.handle}`,
            }),
          });
        }

        // Track performance of posted tweets
        try {
          const tracked = await checkPerformance(agent);
          performanceTracked += tracked;
        } catch (err) {
          console.error(`[cron] performance tracking failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
        }

        // Rebuild learnings once per day (or on first run when null)
        try {
          const existingLearnings = await getLearnings(agent.id);
          const hasPerformanceData = (await getPerformanceHistory(agent.id, 1)).length > 0;
          const learningsAge = existingLearnings?.updatedAt
            ? Date.now() - new Date(existingLearnings.updatedAt).getTime()
            : Infinity;
          const oneDayMs = 24 * 60 * 60 * 1000;

          if (hasPerformanceData && (!existingLearnings || learningsAge > oneDayMs)) {
            const learnings = await buildLearnings(agent);
            await autoAdjustSettings(agent.id, learnings);
          }
        } catch (err) {
          console.error(`[cron] learnings build failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
        }

        // Auto re-analyze if analysis is older than 7 days
        try {
          await maybeReanalyze(agent);
        } catch (err) {
          console.error(`[cron] re-analysis failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
        }

        // Evolve soul if conditions are met (weekly, 50+ tweets tracked)
        try {
          const evoResult = await maybeEvolveSoul(agent);
          if (evoResult.evolved) {
            console.log(`[cron] soul evolved for agent ${agent.id}: ${evoResult.changeSummary}`);
          }
        } catch (err) {
          console.error(`[cron] soul evolution failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
        }

        // Proactive engagement (reply to viral tweets + like network content)
        // Reuse `settings` from the early-exit check above instead of refetching.
        if (settings.proactiveReplies || settings.proactiveLikes || settings.autoFollow) {
          try {
            const agentKeys = decodeKeys({
              apiKey: agent.apiKey!,
              apiSecret: agent.apiSecret!,
              accessToken: agent.accessToken!,
              accessSecret: agent.accessSecret!,
            });
            const viralReplies = await replyToViralTweets(agent, agentKeys, settings);
            const likes = await likeNetworkTweets(agent, agentKeys, settings);
            const follows = await discoverAndFollow(agent, agentKeys, settings);
            if (viralReplies > 0 || likes > 0 || follows > 0) {
              console.log(`[cron] proactive engagement for agent ${agent.id}: ${viralReplies} viral replies, ${likes} likes, ${follows} follows`);
            }
          } catch (err) {
            console.error(`[cron] proactive engagement failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
            await addPostLogEntry(agent.id, {
              agentId: agent.id,
              tweetId: '',
              xTweetId: '',
              content: '',
              format: 'proactive_engagement_error',
              topic: 'network_growth',
              postedAt: new Date().toISOString(),
              source: 'cron',
              action: 'error',
              reason: formatActionError(err, 'proactive_engagement', {
                handle: `@${agent.handle}`,
              }),
            });
          }
        }
      }

      // Run autopilot if auto-post OR auto-reply is enabled (settings already loaded above)
      if (!settings.enabled && !settings.autoReply) continue;

      try {
        if (settings.enabled) {
          await runAutopilotWatchdog(agent, settings);
        }

        const result = await runAutopilot(agent);
        autopilotResults.push(result);

        // Log the result to the agent's post log (skips, errors, etc.)
        if (result.action !== 'posted') {
          // Posted tweets are already logged by runAutopilot itself
          await addPostLogEntry(agent.id, {
            agentId: agent.id,
            tweetId: result.tweetId || '',
            xTweetId: result.xTweetId || '',
            content: result.content || '',
            format: result.format || 'cron',
            topic: result.topic || '',
            postedAt: new Date().toISOString(),
            source: 'cron',
            action: result.action,
            reason: result.reason,
          });
        }

        if (settings.enabled) {
          await refreshAutopilotHealth(agent, undefined, { clearExternalBlockers: result.action === 'posted' });
        }
      } catch (err) {
        const reason = formatActionError(err, 'run_autopilot', {
          handle: `@${agent.handle}`,
        });
        autopilotResults.push({
          agentId: agent.id,
          action: 'error',
          reason,
        });
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'cron_autopilot_error',
          topic: 'autopilot',
          postedAt: new Date().toISOString(),
          source: 'cron',
          action: 'error',
          reason,
        });
        await refreshAutopilotHealth(agent).catch(() => null);
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      mentionsRefreshed,
      performanceTracked,
      autopilotProcessed: autopilotResults.length,
      results: autopilotResults,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function refreshMentions(agentId: string): Promise<number> {
  const agent = await getAgent(agentId);
  if (!agent || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) return 0;

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // Use stored xUserId instead of burning an API call on getMe()
  const stored = await getMentions(agentId);
  // Coerce tweetId to string — Upstash auto-deserializes numeric-looking strings as numbers
  const storedTweetIds = new Set(stored.map((m) => String(m.tweetId)).filter(Boolean));

  // Pass sinceId to only fetch new mentions (saves API quota on busy accounts)
  const latestStoredTweetId = stored.length > 0 ? String(stored[0].tweetId) : undefined;

  let rawMentions;
  try {
    rawMentions = await getMentionsFromTwitter(keys, String(agent.xUserId), latestStoredTweetId);
  } catch (err) {
    if (isInvalidTwitterCredentialError(err)) {
      await invalidateAgentConnection(agentId);
      await addPostLogEntry(agentId, {
        agentId,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'cron_mentions_error',
        topic: 'mentions',
        postedAt: new Date().toISOString(),
        source: 'cron',
        action: 'error',
        reason: `X credentials rejected by X. Agent disconnected, reconnect in Settings. ${formatActionError(err, 'fetch_mentions', {
          handle: `@${agent.handle}`,
          xUserId: agent.xUserId,
        })}`,
      });
    }
    return 0;
  }

  if (!rawMentions || rawMentions.length === 0) return 0;

  let added = 0;
  for (const m of rawMentions) {
    if (storedTweetIds.has(String(m.id))) continue;
    await createMention({
      agentId,
      author: String(m.authorName || m.authorId),
      authorHandle: `@${String(m.authorUsername || m.authorId)}`,
      content: m.text,
      tweetId: m.id,
      conversationId: m.conversationId || null,
      inReplyToTweetId: m.inReplyToTweetId || null,
      engagementLikes: 0,
      engagementRetweets: 0,
      createdAt: m.createdAt,
    });
    added++;
  }

  return added;
}
