import {
  addLearningSignal,
  deleteTweet,
  getAgent,
  getTweets,
  logFunnelEvent,
  updateAgent,
  updateProtocolSettings,
  updateTweet,
} from './kv-storage';
import { clampPostsPerDay } from './survivability';
import { getGeneratedPublishIssue } from './generation-origin';
import { assertAgentAutomationEntitlement } from './automation-entitlement';

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
  await assertAgentAutomationEntitlement(agentId, { agent });

  const agentTweets = await getTweets(agentId);
  const previewTweets = agentTweets.filter((tweet) => tweet.status === 'preview');
  // Vercel KV (Upstash) auto-deserializes numeric strings as numbers.
  // Client sends "42" (string), KV returns 42 (number). Coerce all IDs to strings.
  const previewIds = new Set(previewTweets.map((tweet) => String(tweet.id)));
  // Approvals that a previous, partially failed launch already moved to the
  // queue. Resolving them here makes a retry with the same body succeed
  // instead of failing with "generate preview tweets" after the tweets were
  // re-statused but before settings/agent state were written.
  const alreadyQueuedIds = new Set(
    agentTweets
      .filter((tweet) => tweet.status === 'queued' && !tweet.quarantinedAt)
      .map((tweet) => String(tweet.id)),
  );
  const requestedApprovals = dedupeIds(approvedTweetIds).map(String);

  // Resolve approved IDs against what actually exists in KV.
  const retiredApprovalIds = requestedApprovals.filter((id) => {
    const tweet = previewTweets.find((entry) => String(entry.id) === id);
    return tweet ? Boolean(getGeneratedPublishIssue(tweet, { accountHandle: agent.handle })) : false;
  });
  const newlyApprovedIds = requestedApprovals.filter((id) => previewIds.has(id) && !retiredApprovalIds.includes(id));
  const resumedApprovalIds = requestedApprovals.filter((id) => !previewIds.has(id) && alreadyQueuedIds.has(id));
  const approvedIds = [...newlyApprovedIds, ...resumedApprovalIds];

  // If no valid approvals remain, check if there are any preview tweets at all
  if (previewTweets.length === 0 && resumedApprovalIds.length === 0) {
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

  await Promise.all(newlyApprovedIds.map((id) => updateTweet(id, { status: 'queued' })));
  await Promise.all(newlyApprovedIds.map((id) => {
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
    resumedCount: resumedApprovalIds.length,
    discardedCount: rejectedIds.length,
    postsPerDay,
  };
}
