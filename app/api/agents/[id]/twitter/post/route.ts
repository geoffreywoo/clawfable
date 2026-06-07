import { NextRequest, NextResponse } from 'next/server';
import { addLearningSignal, addPostLogEntry, acquireAutopilotLock, getTweet, invalidateAgentConnection, releaseAutopilotLock, updateTweet } from '@/lib/kv-storage';
import { postTweet, replyToTweet, decodeKeys, getSanitizedTweetTextIssue } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getTweetCompletenessIssue, getTweetLengthIssue } from '@/lib/survivability';
import { resolveQueuedTweetFailure } from '@/lib/queue-healing';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError } from '@/lib/twitter-debug';
import { metadataWithStyleMode } from '@/lib/style-mode';
import { assessTasteRisk } from '@/lib/virality-signals';
import { findPostedReplyForConversation, normalizeTweetTarget } from '@/lib/reply-conversation-guard';
import { areRepliesDisabled, REPLY_AUTOMATION_DISABLED_REASON } from '@/lib/reply-safety';

// POST /api/agents/[id]/twitter/post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let dbTweetId: string | null = null;
  let existingTweet = null as Awaited<ReturnType<typeof getTweet>> | null;
  let isReply = false;
  let currentAgent: Awaited<ReturnType<typeof requireAgentAccess>>['agent'] | null = null;
  let lockOwner: string | null = null;
  try {
    const { agent } = await requireAgentAccess(id);
    currentAgent = agent;

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const body = await request.json();
    const { content, replyToId, tweetId } = body;
    dbTweetId = tweetId ? String(tweetId) : null;
    if (!content) return NextResponse.json({ error: 'Content required' }, { status: 400 });
    existingTweet = dbTweetId ? await getTweet(String(dbTweetId)) : null;
    if (dbTweetId && (!existingTweet || String(existingTweet.agentId) !== String(id))) {
      return NextResponse.json({ error: 'Tweet not found for this agent' }, { status: 404 });
    }
    if (existingTweet?.status === 'posted' && existingTweet.xTweetId) {
      return NextResponse.json({
        success: true,
        alreadyPosted: true,
        tweetUrl: `https://x.com/${agent.handle.replace(/^@/, '')}/status/${existingTweet.xTweetId}`,
        tweetId: existingTweet.xTweetId,
      });
    }
    const inferredReplyToId = existingTweet?.type === 'reply'
      ? (existingTweet.followupForTweetId || existingTweet.quoteTweetId || null)
      : null;
    const effectiveReplyToId = normalizeTweetTarget(replyToId) || inferredReplyToId;
    let replyConversationId = normalizeTweetTarget(body?.conversationId || body?.replyConversationId)
      || existingTweet?.replyConversationId
      || null;
    isReply = existingTweet?.type === 'reply' || Boolean(effectiveReplyToId);
    if (isReply && !replyConversationId) {
      replyConversationId = existingTweet?.followupForTweetId || existingTweet?.quoteTweetId || effectiveReplyToId;
    }
    if (isReply && areRepliesDisabled()) {
      await addPostLogEntry(id, {
        agentId: id,
        tweetId: dbTweetId || '',
        xTweetId: '',
        content: String(content),
        format: 'manual_reply_emergency_disabled',
        topic: existingTweet?.topic || 'reply',
        postedAt: new Date().toISOString(),
        source: 'manual',
        action: 'skipped',
        reason: REPLY_AUTOMATION_DISABLED_REASON,
      }).catch(() => null);
      return NextResponse.json({
        error: REPLY_AUTOMATION_DISABLED_REASON,
        code: 'reply_emergency_disabled',
      }, { status: 503 });
    }

    const sanitizedIssue = getSanitizedTweetTextIssue(String(content), isReply ? 'reply' : 'post');
    if (sanitizedIssue) {
      if (dbTweetId && existingTweet?.status === 'queued') {
        const resolved = await resolveQueuedTweetFailure(agent, existingTweet, sanitizedIssue);
        return NextResponse.json({
          error: sanitizedIssue,
          autoFixed: resolved.action === 'repaired',
          queueResolved: true,
          repairedContent: resolved.tweet?.content ?? null,
          queueAction: resolved.action,
        }, { status: 422 });
      }
      return NextResponse.json({ error: sanitizedIssue }, { status: 422 });
    }

    const lengthIssue = getTweetLengthIssue(String(content), isReply ? 'reply' : 'post');
    if (lengthIssue) {
      if (dbTweetId && existingTweet?.status === 'queued') {
        const resolved = await resolveQueuedTweetFailure(agent, existingTweet, lengthIssue);
        return NextResponse.json({
          error: lengthIssue,
          autoFixed: resolved.action === 'repaired',
          queueResolved: true,
          repairedContent: resolved.tweet?.content ?? null,
          queueAction: resolved.action,
        }, { status: 422 });
      }
      return NextResponse.json({ error: lengthIssue }, { status: 422 });
    }

    const completenessIssue = getTweetCompletenessIssue(String(content));
    if (completenessIssue) {
      if (dbTweetId && existingTweet?.status === 'queued') {
        const resolved = await resolveQueuedTweetFailure(agent, existingTweet, completenessIssue);
        return NextResponse.json({
          error: completenessIssue,
          autoFixed: resolved.action === 'repaired',
          queueResolved: true,
          repairedContent: resolved.tweet?.content ?? null,
          queueAction: resolved.action,
        }, { status: 422 });
      }
      return NextResponse.json({ error: completenessIssue }, { status: 422 });
    }

    const taste = assessTasteRisk(String(content), {
      surface: isReply ? 'reply' : 'post',
      policyRiskScore: existingTweet?.policyRiskScore,
      creativeRiskScore: existingTweet?.creativeRiskScore,
      slopScore: existingTweet?.slopScore,
      voiceScore: existingTweet?.voiceScore,
      highValueScore: existingTweet?.replyBaitScore,
    });
    if (taste.action === 'block') {
      return NextResponse.json({
        error: `Taste gate blocked posting: ${taste.reasons.join(', ') || 'quality risk'}`,
        tasteRisk: {
          score: taste.score,
          action: taste.action,
          reasons: taste.reasons,
        },
      }, { status: 422 });
    }

    const lock = await acquireAutopilotLock(id, `manual-post:${Date.now()}:${dbTweetId || 'ad-hoc'}`, 8 * 60, 'manual');
    if (!lock.acquired) {
      const reason = lock.lock
        ? `Posting already running since ${lock.lock.acquiredAt}; lock expires ${lock.lock.expiresAt}.`
        : 'Posting already running.';
      return NextResponse.json({ error: reason, code: 'lock_held' }, { status: 409 });
    }
    lockOwner = lock.owner;

    if (dbTweetId) {
      existingTweet = await getTweet(String(dbTweetId));
      if (!existingTweet || String(existingTweet.agentId) !== String(id)) {
        return NextResponse.json({ error: 'Tweet not found for this agent' }, { status: 404 });
      }
      if (existingTweet.status === 'posted' && existingTweet.xTweetId) {
        return NextResponse.json({
          success: true,
          alreadyPosted: true,
          tweetUrl: `https://x.com/${agent.handle.replace(/^@/, '')}/status/${existingTweet.xTweetId}`,
          tweetId: existingTweet.xTweetId,
        });
      }
      if (isReply && !replyConversationId) {
        replyConversationId = existingTweet.replyConversationId
          || existingTweet.followupForTweetId
          || existingTweet.quoteTweetId
          || effectiveReplyToId;
      }
    }

    if (isReply) {
      const duplicateReply = await findPostedReplyForConversation(id, replyConversationId, dbTweetId);
      if (duplicateReply) {
        const reason = `Reply conversation gate: this account already posted reply ${duplicateReply.xTweetId} for conversation ${replyConversationId}.`;
        await addPostLogEntry(id, {
          agentId: id,
          tweetId: dbTweetId || '',
          xTweetId: '',
          content: String(content),
          format: 'manual_reply_duplicate_gate',
          topic: existingTweet?.topic || 'reply',
          postedAt: new Date().toISOString(),
          source: 'manual',
          action: 'skipped',
          reason,
        }).catch(() => null);
        return NextResponse.json({
          error: 'This account has already replied to that root conversation.',
          code: 'duplicate_reply_conversation',
          duplicateSource: duplicateReply.source,
          existingTweetId: duplicateReply.tweetId,
          existingXTweetId: duplicateReply.xTweetId,
        }, { status: 409 });
      }
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    let result: { tweetUrl: string; tweetId: string; username: string };
    if (effectiveReplyToId) {
      result = await replyToTweet(keys, content, String(effectiveReplyToId), { username: agent.handle });
    } else {
      result = await postTweet(keys, content, { username: agent.handle });
    }

    const postedAt = new Date().toISOString();
    const persistenceFailures: string[] = [];
    if (dbTweetId) {
      try {
        const updated = await updateTweet(String(dbTweetId), {
          status: 'posted',
          xTweetId: result.tweetId,
          postedAt,
          followupForTweetId: isReply ? effectiveReplyToId : existingTweet?.followupForTweetId,
          replyConversationId: isReply ? replyConversationId : existingTweet?.replyConversationId,
        });
        await addLearningSignal(id, {
          tweetId: String(dbTweetId),
          xTweetId: result.tweetId,
          signalType: updated.type === 'reply' ? 'reply_posted' : 'x_post_succeeded',
          surface: updated.type === 'reply' ? 'mentions' : 'manual_post',
          rewardDelta: 0.72,
          metadata: metadataWithStyleMode(updated, {
            confidenceScore: updated.confidenceScore ?? null,
            candidateScore: updated.candidateScore ?? null,
            targetTweetId: isReply ? effectiveReplyToId ?? null : null,
            replyConversationId: isReply ? replyConversationId ?? null : null,
            generationMode: updated.generationMode ?? null,
            draftExperimentId: updated.draftExperimentId ?? null,
            creativeLane: updated.creativeLane ?? null,
            experimentHoldout: updated.experimentHoldout === true,
            wasEdited: (existingTweet?.editCount ?? 0) > 0,
          }),
        });
      } catch (persistErr) {
        persistenceFailures.push(persistErr instanceof Error ? persistErr.message : 'tweet persistence failed');
      }
    }

    await addPostLogEntry(id, {
      agentId: id,
      tweetId: dbTweetId || '',
      xTweetId: result.tweetId,
      content: String(content),
      format: isReply ? 'manual_reply' : 'manual_post',
      topic: existingTweet?.topic || (isReply ? 'reply' : 'manual'),
      postedAt,
      source: 'manual',
      action: 'posted',
      reason: persistenceFailures.length
        ? `Posted to X, but local persistence had warnings: ${persistenceFailures.join('; ')}`
        : 'Posted manually.',
    }).catch(() => null);

    return NextResponse.json({
      success: true,
      tweetUrl: result.tweetUrl,
      tweetId: result.tweetId,
      persistenceWarning: persistenceFailures.length ? persistenceFailures.join('; ') : undefined,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = formatActionError(err, isReply ? 'manual_reply' : 'manual_post', {
      draftId: dbTweetId || undefined,
    });
    let queueAction: string | null = null;
    let repairedContent: string | null = null;

    if (currentAgent && isInvalidTwitterCredentialError(err)) {
      await invalidateAgentConnection(currentAgent.id);
      return NextResponse.json({
        error: `X credentials rejected by X. Agent disconnected, reconnect in Settings. ${message}`,
        queueResolved: false,
        autoFixed: false,
        repairedContent: null,
        queueAction: null,
      }, { status: 401 });
    }

    const rateLimited = isRateLimitTwitterError(err);
    if (rateLimited || isTransientTwitterError(err)) {
      const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
      const retryMessage = rateLimited
        ? `X posting is rate limited${resetAt ? ` until ${resetAt}` : ''}. Try again after the reset.`
        : 'Temporary X posting failure. Try again in a few minutes.';
      return NextResponse.json({
        error: `${retryMessage} ${formatActionError(err, isReply ? 'reply_to_tweet' : 'post_tweet', {
          handle: currentAgent ? `@${currentAgent.handle}` : undefined,
          tweetId: dbTweetId,
        })}`,
        queueResolved: false,
        autoFixed: false,
        repairedContent: null,
        queueAction: null,
        retryable: true,
      }, { status: rateLimited ? 429 : 503 });
    }

    if (dbTweetId) {
      await addLearningSignal(id, {
        tweetId: dbTweetId,
        signalType: isReply ? 'reply_rejected' : 'x_post_rejected',
        surface: isReply ? 'mentions' : 'manual_post',
        rewardDelta: -0.75,
        reason: message,
        metadata: metadataWithStyleMode(existingTweet, {
          draftExperimentId: existingTweet?.draftExperimentId ?? null,
          creativeLane: existingTweet?.creativeLane ?? null,
          experimentHoldout: existingTweet?.experimentHoldout === true,
        }),
      }).catch(() => null);
    }

    if (dbTweetId && existingTweet?.status === 'queued' && currentAgent) {
      const resolved = await resolveQueuedTweetFailure(currentAgent, existingTweet, message).catch(() => null);
      queueAction = resolved?.action ?? null;
      repairedContent = resolved?.tweet?.content ?? null;
    }
    return NextResponse.json({
      error: message,
      queueResolved: Boolean(queueAction),
      autoFixed: queueAction === 'repaired',
      repairedContent,
      queueAction,
    }, { status: 500 });
  } finally {
    if (lockOwner) {
      await releaseAutopilotLock(id, lockOwner).catch(() => false);
    }
  }
}
