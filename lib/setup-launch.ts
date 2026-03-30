import {
  deleteTweet,
  getAgent,
  getPreviewTweets,
  logFunnelEvent,
  updateAgent,
  updateProtocolSettings,
  updateTweet,
} from './kv-storage';
import { clampPostsPerDay } from './survivability';

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
  if (previewTweets.length === 0) {
    throw new SetupLaunchError('Generate preview tweets before launch');
  }

  const previewIds = new Set(previewTweets.map((tweet) => tweet.id));
  const reviewedIds = dedupeIds(reviewedTweetIds);
  const approvedIds = dedupeIds(approvedTweetIds);

  if (reviewedIds.length !== previewIds.size || reviewedIds.some((id) => !previewIds.has(id))) {
    throw new SetupLaunchError('Review every preview tweet before launch');
  }

  if (approvedIds.length === 0) {
    throw new SetupLaunchError('Approve at least one preview tweet before launch');
  }

  if (approvedIds.some((id) => !previewIds.has(id))) {
    throw new SetupLaunchError('Approved tweets must come from the active preview batch');
  }

  const approvedIdSet = new Set(approvedIds);
  const rejectedIds = previewTweets
    .filter((tweet) => !approvedIdSet.has(tweet.id))
    .map((tweet) => tweet.id);

  await Promise.all(approvedIds.map((id) => updateTweet(id, { status: 'queued' })));
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
