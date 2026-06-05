import { NextRequest, NextResponse } from 'next/server';
import { addLearningSignal, deleteTweet, getTweet, markIdeaAtomRejectedForTweet, saveFeedback, updateTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { inferDeleteIntent } from '@/lib/delete-intent';
import { summarizeEditDelta } from '@/lib/learning-loop';
import { metadataWithStyleMode } from '@/lib/style-mode';
import { validateQueueUpdateRequest } from '@/lib/request-validation';
import { getTweetCompletenessIssue } from '@/lib/survivability';
import { assessTasteRisk } from '@/lib/virality-signals';

// PATCH /api/agents/[id]/queue/[tweetId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { id, tweetId } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const tweet = await getTweet(String(tweetId));
    if (!tweet || String(tweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const body = await request.json();
    const parsed = validateQueueUpdateRequest(body);
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid queue update' }, { status: 400 });
    }
    const { content, status, scheduledAt, deletionReason } = parsed.value;
    const updates: Record<string, unknown> = {};
    if (content !== undefined) updates.content = content;
    if (status !== undefined) {
      if (status === 'queued') {
        const candidateContent = content ?? tweet.content;
        const completenessIssue = getTweetCompletenessIssue(candidateContent);
        if (completenessIssue) {
          return NextResponse.json({ error: completenessIssue }, { status: 422 });
        }
        const taste = assessTasteRisk(candidateContent, {
          surface: tweet.type === 'reply' ? 'reply' : 'post',
          policyRiskScore: tweet.policyRiskScore,
          creativeRiskScore: tweet.creativeRiskScore,
          slopScore: tweet.slopScore,
          voiceScore: tweet.voiceScore,
        });
        if (taste.action === 'block') {
          return NextResponse.json({ error: `Taste gate blocked queueing: ${taste.reasons.join(', ') || 'quality risk'}` }, { status: 422 });
        }
      }
      updates.status = status;
    }
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt;
    if (deletionReason !== undefined) updates.deletionReason = deletionReason;
    const updated = await updateTweet(tweetId, updates as Parameters<typeof updateTweet>[1]);

    if (status === 'queued' && tweet.status !== 'queued') {
      if ((updated.editCount ?? 0) > 0 && updated.originalContent && updated.originalContent !== updated.content) {
        const editSummary = summarizeEditDelta(updated.originalContent, updated.content);
        await addLearningSignal(id, {
          tweetId: tweet.id,
          signalType: 'edited_before_queue',
          surface: tweet.type === 'reply' ? 'mentions' : tweet.status === 'preview' ? 'setup' : 'queue',
          rewardDelta: editSummary.rewardDelta,
          reason: editSummary.summary,
          metadata: metadataWithStyleMode(tweet, {
            ...editSummary.metadata,
            preferenceHint: editSummary.preferenceHints[0] || null,
            preferenceHints: editSummary.preferenceHints.join('\n') || null,
            originalDraft: updated.originalContent.slice(0, 500),
            editedDraft: updated.content.slice(0, 500),
            draftExperimentId: updated.draftExperimentId ?? null,
            creativeLane: updated.creativeLane ?? null,
            experimentHoldout: updated.experimentHoldout === true,
            timeToApprovalMins: Math.round((Date.now() - new Date(tweet.createdAt).getTime()) / 60000),
          }),
        });
      } else {
        await addLearningSignal(id, {
          tweetId: tweet.id,
          signalType: 'approved_without_edit',
          surface: tweet.type === 'reply' ? 'mentions' : tweet.status === 'preview' ? 'setup' : 'queue',
          rewardDelta: 0.85,
          metadata: metadataWithStyleMode(tweet, {
            draftExperimentId: updated.draftExperimentId ?? null,
            creativeLane: updated.creativeLane ?? null,
            experimentHoldout: updated.experimentHoldout === true,
            timeToApprovalMins: Math.round((Date.now() - new Date(tweet.createdAt).getTime()) / 60000),
          }),
        });
      }
    }

    if (status === 'posted' && tweet.status !== 'posted') {
      if ((updated.editCount ?? 0) > 0 && updated.originalContent && updated.originalContent !== updated.content) {
        const editSummary = summarizeEditDelta(updated.originalContent, updated.content);
        await addLearningSignal(id, {
          tweetId: tweet.id,
          xTweetId: updated.xTweetId || undefined,
          signalType: 'edited_before_post',
          surface: tweet.type === 'reply' ? 'mentions' : 'manual_post',
          rewardDelta: editSummary.rewardDelta,
          reason: editSummary.summary,
          metadata: metadataWithStyleMode(tweet, {
            ...editSummary.metadata,
            preferenceHint: editSummary.preferenceHints[0] || null,
            preferenceHints: editSummary.preferenceHints.join('\n') || null,
            originalDraft: updated.originalContent.slice(0, 500),
            editedDraft: updated.content.slice(0, 500),
            draftExperimentId: updated.draftExperimentId ?? null,
            creativeLane: updated.creativeLane ?? null,
            experimentHoldout: updated.experimentHoldout === true,
            timeToApprovalMins: Math.round((Date.now() - new Date(tweet.createdAt).getTime()) / 60000),
          }),
        });
      }
      await addLearningSignal(id, {
        tweetId: tweet.id,
        xTweetId: updated.xTweetId || undefined,
        signalType: tweet.type === 'reply' ? 'reply_posted' : 'x_post_succeeded',
        surface: tweet.type === 'reply' ? 'mentions' : 'manual_post',
        rewardDelta: 0.7,
        metadata: metadataWithStyleMode(updated, {
          confidenceScore: updated.confidenceScore ?? null,
          candidateScore: updated.candidateScore ?? null,
          generationMode: updated.generationMode ?? null,
          draftExperimentId: updated.draftExperimentId ?? null,
          creativeLane: updated.creativeLane ?? null,
          experimentHoldout: updated.experimentHoldout === true,
        }),
      });
    }

    if (deletionReason !== undefined && tweet.status === 'deleted_from_x') {
      const trimmedReason = typeof deletionReason === 'string' ? deletionReason.trim() : '';
      if (trimmedReason && trimmedReason !== 'skipped') {
        await saveFeedback(id, {
          tweetId: tweet.id,
          tweetText: tweet.content,
          rating: 'down',
          generatedAt: new Date().toISOString(),
          reason: trimmedReason,
          intentSummary: trimmedReason,
          source: 'queue_delete',
          userProvidedReason: true,
        });
        await addLearningSignal(id, {
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || undefined,
          signalType: 'deleted_from_x',
          surface: 'queue',
          rewardDelta: -0.95,
          reason: trimmedReason,
          metadata: metadataWithStyleMode(tweet, {
            userProvidedReason: true,
            draftExperimentId: tweet.draftExperimentId ?? null,
            creativeLane: tweet.creativeLane ?? null,
            experimentHoldout: tweet.experimentHoldout === true,
          }),
        });
      } else if (trimmedReason === 'skipped') {
        const inferredReason = await inferDeleteIntent({
          agentName: agent.name,
          soulMd: agent.soulMd,
          tweetText: tweet.content,
        });
        await saveFeedback(id, {
          tweetId: tweet.id,
          tweetText: tweet.content,
          rating: 'down',
          generatedAt: new Date().toISOString(),
          intentSummary: inferredReason,
          source: 'queue_delete',
          userProvidedReason: false,
        });
        await addLearningSignal(id, {
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || undefined,
          signalType: 'deleted_from_x',
          surface: 'queue',
          rewardDelta: -0.8,
          reason: inferredReason,
          inferred: true,
          metadata: metadataWithStyleMode(tweet, {
            userProvidedReason: false,
            draftExperimentId: tweet.draftExperimentId ?? null,
            creativeLane: tweet.creativeLane ?? null,
            experimentHoldout: tweet.experimentHoldout === true,
          }),
        });
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to update tweet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/agents/[id]/queue/[tweetId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { id, tweetId } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const tweet = await getTweet(String(tweetId));
    if (!tweet || String(tweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const userReason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const intentSummary = userReason || await inferDeleteIntent({
      agentName: agent.name,
      soulMd: agent.soulMd,
      tweetText: tweet.content,
    });

    await saveFeedback(id, {
      tweetId: tweet.id,
      tweetText: tweet.content,
      rating: 'down',
      generatedAt: new Date().toISOString(),
      reason: userReason || undefined,
      intentSummary,
      source: 'queue_delete',
      userProvidedReason: !!userReason,
    });
    await addLearningSignal(id, {
      tweetId: tweet.id,
      signalType: 'deleted_from_queue',
      surface: tweet.type === 'reply' ? 'mentions' : 'queue',
      rewardDelta: -0.75,
      reason: intentSummary,
      inferred: !userReason,
      metadata: metadataWithStyleMode(tweet, {
        userProvidedReason: !!userReason,
        draftExperimentId: tweet.draftExperimentId ?? null,
        creativeLane: tweet.creativeLane ?? null,
        experimentHoldout: tweet.experimentHoldout === true,
      }),
    });

    await markIdeaAtomRejectedForTweet(tweet, intentSummary);
    await deleteTweet(tweetId);
    return NextResponse.json({
      success: true,
      feedbackSource: userReason ? 'user' : 'inferred',
      intentSummary,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to delete tweet' }, { status: 500 });
  }
}
