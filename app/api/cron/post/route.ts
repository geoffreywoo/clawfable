import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getProtocolSettings, getAgent, createMention, getMentions, addPostLogEntry, getJobs, updateJob, createTweet, getAnalysis } from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { generateViralBatch } from '@/lib/viral-generator';
import { runAutopilot } from '@/lib/autopilot';
import type { AutopilotResult } from '@/lib/autopilot';
import { decodeKeys, getMe, getMentionsFromTwitter } from '@/lib/twitter-client';
import { checkPerformance, buildLearnings, autoAdjustSettings, maybeReanalyze } from '@/lib/performance';

// GET /api/cron/post — called by Vercel Cron every 30 minutes
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authBearer = request.headers.get('authorization');
    if (authBearer !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const agents = await getAgents();
    const autopilotResults: AutopilotResult[] = [];
    let mentionsRefreshed = 0;
    let performanceTracked = 0;

    for (const agent of agents) {
      const isConnected = agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId;

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
        }

        // Track performance of posted tweets + rebuild learnings + auto-adjust
        try {
          const tracked = await checkPerformance(agent);
          performanceTracked += tracked;
          if (tracked > 0) {
            const learnings = await buildLearnings(agent);
            // Auto-adjust content settings based on what actually performed
            await autoAdjustSettings(agent.id, learnings);
          }
        } catch (err) {
          console.error(`[cron] performance tracking failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
        }

        // Auto re-analyze if analysis is older than 7 days
        try {
          await maybeReanalyze(agent);
        } catch (err) {
          console.error(`[cron] re-analysis failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
        }
      }

      // Run autopilot if auto-post OR auto-reply is enabled
      const settings = await getProtocolSettings(agent.id);
      if (!settings.enabled && !settings.autoReply) continue;

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
          format: 'cron',
          topic: '',
          postedAt: new Date().toISOString(),
          source: 'cron',
          action: result.action,
          reason: result.reason,
        });
      }
    }

    // --- Execute scheduled jobs ---
    let jobsExecuted = 0;
    for (const agent of agents) {
      try {
        const jobs = await getJobs(agent.id);
        for (const job of jobs) {
          if (!job.enabled) continue;
          const intervalMs = parseScheduleInterval(job.schedule);
          if (!intervalMs) continue;
          const elapsed = job.lastRunAt ? Date.now() - new Date(job.lastRunAt).getTime() : Infinity;
          if (elapsed < intervalMs) continue;

          // Job is due — generate tweets matching its filters
          const analysis = await getAnalysis(agent.id);
          if (!analysis) continue;

          const voiceProfile = parseSoulMd(agent.name, agent.soulMd);
          const count = Math.min(job.postsPerRun || 1, 5);

          const batch = await generateViralBatch(voiceProfile, analysis, count, null, null, agent.soulMd);
          for (const item of batch) {
            await createTweet({
              agentId: agent.id,
              content: item.content,
              type: item.quoteTweetId ? 'quote' : 'original',
              status: 'queued',
              topic: job.topics[0] || item.targetTopic || 'general',
              xTweetId: null,
              quoteTweetId: item.quoteTweetId || null,
              quoteTweetAuthor: item.quoteTweetAuthor || null,
              scheduledAt: null,
            });
          }

          await updateJob(job.id, {
            lastRunAt: new Date().toISOString(),
            totalPosted: (job.totalPosted || 0) + batch.length,
          });
          jobsExecuted++;

          await addPostLogEntry(agent.id, {
            agentId: agent.id,
            tweetId: '',
            xTweetId: '',
            content: `Job "${job.name}" queued ${batch.length} tweet${batch.length !== 1 ? 's' : ''}`,
            format: 'job',
            topic: job.topics[0] || 'general',
            postedAt: new Date().toISOString(),
            source: 'cron',
            action: 'job_executed',
            reason: job.name,
          });
        }
      } catch (err) {
        console.error(`[cron] job execution failed for agent ${agent.id}:`, err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      mentionsRefreshed,
      performanceTracked,
      autopilotProcessed: autopilotResults.length,
      jobsExecuted,
      results: autopilotResults,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function refreshMentions(agentId: string): Promise<number> {
  const agent = await getAgent(agentId);
  if (!agent || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) return 0;

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  let rawMentions;
  try {
    const me = await getMe(keys);
    rawMentions = await getMentionsFromTwitter(keys, me.id);
  } catch {
    return 0;
  }

  if (!rawMentions || rawMentions.length === 0) return 0;

  const stored = await getMentions(agentId);
  const storedTweetIds = new Set(stored.map((m) => m.tweetId).filter(Boolean));

  let added = 0;
  for (const m of rawMentions) {
    if (storedTweetIds.has(m.id)) continue;
    await createMention({
      agentId,
      author: String(m.authorName || m.authorId),
      authorHandle: `@${String(m.authorUsername || m.authorId)}`,
      content: m.text,
      tweetId: m.id,
      engagementLikes: 0,
      engagementRetweets: 0,
      createdAt: m.createdAt,
    });
    added++;
  }

  return added;
}

// Parse human-readable schedule to interval in ms
function parseScheduleInterval(schedule: string): number | null {
  const s = schedule.toLowerCase().trim();
  // "every Xh" or "every X hours"
  const hourMatch = s.match(/every\s+(\d+)\s*h/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60 * 60 * 1000;
  // "Xx/day" e.g. "3x/day", "1x/day"
  const perDayMatch = s.match(/(\d+)x?\/?(?:per\s*)?day/);
  if (perDayMatch) return (24 / parseInt(perDayMatch[1])) * 60 * 60 * 1000;
  // "daily" = once per day
  if (s.includes('daily')) return 24 * 60 * 60 * 1000;
  // "hourly"
  if (s.includes('hourly')) return 60 * 60 * 1000;
  // "every Xm" or "every X minutes"
  const minMatch = s.match(/every\s+(\d+)\s*m/);
  if (minMatch) return parseInt(minMatch[1]) * 60 * 1000;
  return null;
}
