import {
  addLearningSignal,
  deleteTweet,
  getAgent,
  getPreviewTweets,
  logFunnelEvent,
  markIdeaAtomRejectedForTweet,
  updateAgent,
  updateProtocolSettings,
  updateTweet,
} from './kv-storage';
import { clampPostsPerDay } from './survivability';
import { getGeoffreyGeneratedPublishIssue } from './generation-origin';

export class SetupLaunchError extends Error {}

interface LaunchAgentInput {
  agentId: string;
  reviewedTweetIds: string[];
  approvedTweetIds: string[];
  postsPerDay: number;
}

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0)));
}

export async function launchAgentFromPreview({
  agentId,
  reviewedTweetIds,
  approvedTweetIds,
  postsPerDay: rawPostsPerDay,
}: LaunchAgentInput) {
  const postsPerDay = clampPostsPerDay(rawPostsPerDay);
  if (!Number.isInteger(postsPerDay) || postsPerDay < 1) {
    throw new SetupLaunchError('postsPerDay must be a positive integer');
  }

  const agent = await getAgent(agentId);
  if (!agent) {
    throw new SetupLaunchError('Agent not found');
  }

  const previewTweets = await getPreviewTweets(agentId);
  // Vercel KV (Upstash) auto-deserializes numeric strings as numbers.
  // Client sends "42" (string), KV returns 42 (number). Coerce all IDs to strings.
  const previewIds = new Set(previewTweets.map((tweet) => String(tweet.id)));
  const requestedApprovals = dedupeIds(approvedTweetIds).map(String);

  // Resolve approved IDs against what actually exists in KV.
  const retiredApprovalIds = requestedApprovals.filter((id) => {
    const tweet = previewTweets.find((entry) => String(entry.id) === id);
    return tweet ? Boolean(getGeoffreyGeneratedPublishIssue(agent.handle, tweet)) : false;
  });
  const approvedIds = requestedApprovals.filter((id) => previewIds.has(id) && !retiredApprovalIds.includes(id));

  // If no valid approvals remain, check if there are any preview tweets at all
  if (previewTweets.length === 0) {
    throw new SetupLaunchError('Generate preview tweets before launch');
  }

  if (approvedIds.length === 0) {
    if (retiredApprovalIds.length > 0) {
      throw new SetupLaunchError('Generate and approve a fresh V2 preview before launch');
    }
    throw new SetupLaunchError('Approve at least one preview tweet before launch');
  }

  const approvedIdSet = new Set(approvedIds);
  const rejectedIds = previewTweets
    .filter((tweet) => !approvedIdSet.has(tweet.id))
    .map((tweet) => tweet.id);

  await Promise.all(approvedIds.map((id) => updateTweet(id, { status: 'queued' })));
  await Promise.all(approvedIds.map((id) => {
    const tweet = previewTweets.find((item) => item.id === id);
    if (!tweet) return Promise.resolve();
    return addLearningSignal(agentId, {
      tweetId: tweet.id,
      signalType: 'approved_without_edit',
      surface: 'setup',
      rewardDelta: 0.85,
      metadata: {
        timeToApprovalMins: Math.round((Date.now() - new Date(tweet.createdAt).getTime()) / 60000),
      },
    });
  }));
  const rejectedTweets = previewTweets.filter((tweet) => !approvedIdSet.has(tweet.id));
  await Promise.all(rejectedTweets.map((tweet) => markIdeaAtomRejectedForTweet(tweet, 'Not selected during setup review')));
  await Promise.all(rejectedIds.map((id) => deleteTweet(id)));

  await updateProtocolSettings(agentId, {
    enabled: true,
    postsPerDay,
  });

  await updateAgent(agentId, { setupStep: 'ready' });
  await logFunnelEvent(agentId, 'preview_approve', {
    approvedCount: approvedIds.length,
    rejectedCount: rejectedIds.length,
    postsPerDay,
  });

  return {
    queuedCount: approvedIds.length,
    discardedCount: rejectedIds.length,
    postsPerDay,
  };
}
