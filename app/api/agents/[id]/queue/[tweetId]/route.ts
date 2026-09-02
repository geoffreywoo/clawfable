import { NextRequest, NextResponse } from 'next/server';
import {
  addLearningSignal,
  addSemanticBlock,
  deleteTweet,
  getIdeaCandidates,
  getTweet,
  recordV2CandidateOutcomeForTweet,
  saveFeedback,
  updateTweet,
} from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { inferDeleteIntent } from '@/lib/delete-intent';
import { buildGenerationLearningMetadata, summarizeEditDelta } from '@/lib/learning-loop';
import { metadataWithStyleMode } from '@/lib/style-mode';
import { readJsonObjectBody, validateQueueDeleteRequest, validateQueueUpdateRequest } from '@/lib/request-validation';
import { getTweetCompletenessIssue } from '@/lib/survivability';
import { assessTasteRisk } from '@/lib/virality-signals';
import { classifyTasteFeedbackReason } from '@/lib/account-taste';
import { parseSoulMd } from '@/lib/soul-parser';
import {
  buildSemanticBlockFromQueueFeedback,
  feedbackStage,
  inferQueueFeedbackReasonCode,
  QUEUE_FEEDBACK_OPTIONS,
} from '@/lib/queue-feedback';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';
import { getAccountPublishingPolicyIssue } from '@/lib/account-publish-policy';
import { resolveAntiFundPortfolioContext } from '@/lib/antifund-portfolio';
import { createOperatorChildDraft, isImmutableGeneratedDraft } from '@/lib/draft-lineage';

// PATCH /api/agents/[id]/queue/[tweetId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { id, tweetId } = await params;
  try {
    const { agent, user } = await requireAgentAccess(id);
    const tweet = await getTweet(String(tweetId));
    if (!tweet || String(tweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const body = await readJsonObjectBody(request);
    if (!body.ok || !body.value) {
      return NextResponse.json({ error: body.error || 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = validateQueueUpdateRequest(body.value);
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid queue update' }, { status: 400 });
    }
    const { content, status, scheduledAt, deletionReason } = parsed.value;
    const immutableV2Edit = content !== undefined
      && content !== tweet.content
      && isImmutableGeneratedDraft(tweet);
    const updates: Record<string, unknown> = {};
    if (content !== undefined) updates.content = content;
    if (status !== undefined) {
      if (status === 'queued' || status === 'posted') {
        await assertAgentAutomationEntitlement(id, { agent, user });
        const generationOriginIssue = immutableV2Edit ? null : getGeneratedPublishIssue(tweet);
        if (generationOriginIssue) {
          return NextResponse.json({ error: generationOriginIssue, code: 'generation_origin_retired' }, { status: 409 });
        }
      }
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
      if ((status === 'queued' || status === 'posted') && !immutableV2Edit && tweet.type !== 'reply') {
        const publishingPolicyIssue = getAccountPublishingPolicyIssue({
          handle: agent.handle,
          content: content ?? tweet.content,
          topic: tweet.topic,
          portfolioCompanyContext: tweet.portfolioCompanyContext,
        });
        if (publishingPolicyIssue) {
          return NextResponse.json({ error: publishingPolicyIssue, code: 'account_publish_policy' }, { status: 422 });
        }
      }
      updates.status = status;
    }
    if (
      content !== undefined
      && status === undefined
      && tweet.status === 'queued'
      && !immutableV2Edit
      && tweet.type !== 'reply'
    ) {
      const publishingPolicyIssue = getAccountPublishingPolicyIssue({
        handle: agent.handle,
        content,
        topic: tweet.topic,
        portfolioCompanyContext: tweet.portfolioCompanyContext,
      });
      if (publishingPolicyIssue) {
        return NextResponse.json({ error: publishingPolicyIssue, code: 'account_publish_policy' }, { status: 422 });
      }
    }
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt;
    if (deletionReason !== undefined) updates.deletionReason = deletionReason;

    if (immutableV2Edit) {
      const requestedChildStatus = status || (tweet.status === 'queued' ? 'queued' : 'draft');
      const childStatus = requestedChildStatus;
      if (childStatus === 'queued') {
        await assertAgentAutomationEntitlement(id, { agent, user });
        const completenessIssue = getTweetCompletenessIssue(content);
        if (completenessIssue) {
          return NextResponse.json({ error: completenessIssue }, { status: 422 });
        }
      }
      const portfolioCompanyContext = resolveAntiFundPortfolioContext(
        content,
        tweet.portfolioCompanyContext,
        'constructive_conviction',
      );
      if (childStatus === 'queued' && tweet.type !== 'reply') {
        const publishingPolicyIssue = getAccountPublishingPolicyIssue({
          handle: agent.handle,
          content,
          topic: tweet.topic,
          portfolioCompanyContext,
        });
        if (publishingPolicyIssue) {
          return NextResponse.json({ error: publishingPolicyIssue, code: 'account_publish_policy' }, { status: 422 });
        }
      }
      const child = await createOperatorChildDraft(tweet, content, {
        status: childStatus,
        scheduledAt: scheduledAt ?? tweet.scheduledAt,
        portfolioCompanyContext,
      });
      return NextResponse.json({ ...child, immutableParentId: tweet.id });
    }

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
          metadata: metadataWithStyleMode(updated, {
            ...buildGenerationLearningMetadata(updated),
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
          metadata: metadataWithStyleMode(updated, {
            ...buildGenerationLearningMetadata(updated),
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
          metadata: metadataWithStyleMode(updated, {
            ...buildGenerationLearningMetadata(updated),
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
          ...buildGenerationLearningMetadata(updated),
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
        const tasteFeedback = classifyTasteFeedbackReason(trimmedReason, tweet.content, { voiceProfile: parseSoulMd(agent.name, agent.soulMd) });
        const reasonCode = inferQueueFeedbackReasonCode(trimmedReason);
        const stage = feedbackStage(reasonCode);
        const idea = tweet.pipelineVersion === 'v2' && tweet.ideaId
          ? (await getIdeaCandidates(id, 500)).find((candidate) => candidate.id === tweet.ideaId) || null
          : null;
        const semanticBlock = buildSemanticBlockFromQueueFeedback({
          tweet,
          idea,
          reasonCode,
          reason: trimmedReason,
          permanent: /do not regenerate|never (?:write|post|use|cover)/i.test(trimmedReason),
        });
        await saveFeedback(id, {
          tweetId: tweet.id,
          tweetText: tweet.content,
          rating: 'down',
          generatedAt: new Date().toISOString(),
          reason: trimmedReason,
          intentSummary: trimmedReason,
          source: 'queue_delete',
          userProvidedReason: true,
          reasonCode,
          blockScope: semanticBlock?.scope || null,
          permanentBlock: semanticBlock?.permanent || false,
          semanticKey: semanticBlock?.semanticKey || null,
        });
        await addLearningSignal(id, {
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || undefined,
          signalType: 'deleted_from_x',
          surface: 'queue',
          rewardDelta: -0.95,
          reason: trimmedReason,
          metadata: metadataWithStyleMode(tweet, {
            ...buildGenerationLearningMetadata(tweet),
            ...tasteFeedback.metadata,
            userProvidedReason: true,
            feedbackReasonCode: reasonCode,
            feedbackStage: stage,
            feedbackBlockScope: semanticBlock?.scope || null,
            feedbackPermanent: semanticBlock?.permanent || false,
            feedbackSemanticKey: semanticBlock?.semanticKey || null,
            draftExperimentId: tweet.draftExperimentId ?? null,
            creativeLane: tweet.creativeLane ?? null,
            experimentHoldout: tweet.experimentHoldout === true,
          }),
        });
        if (semanticBlock) await addSemanticBlock(id, semanticBlock);
        await recordV2CandidateOutcomeForTweet(tweet, 'deleted', [`feedback:${reasonCode}`], {
          updateIdea: stage !== 'writing' || semanticBlock?.scope !== 'copy',
        });
      } else if (trimmedReason === 'skipped') {
        const inferredReason = await inferDeleteIntent({
          agentName: agent.name,
          soulMd: agent.soulMd,
          tweetText: tweet.content,
        });
        const tasteFeedback = classifyTasteFeedbackReason(inferredReason, tweet.content, { voiceProfile: parseSoulMd(agent.name, agent.soulMd) });
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
            ...buildGenerationLearningMetadata(tweet),
            ...tasteFeedback.metadata,
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
    if (err instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(err), { status: err.status });
    }
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
    const parsed = validateQueueDeleteRequest(body);
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid feedback' }, { status: 400 });
    }
    const userReason = parsed.value.reason || '';
    const structuredOption = parsed.value.reasonCode
      ? QUEUE_FEEDBACK_OPTIONS.find((option) => option.code === parsed.value?.reasonCode)
      : null;
    const intentSummary = userReason
      || structuredOption?.description
      || await inferDeleteIntent({
        agentName: agent.name,
        soulMd: agent.soulMd,
        tweetText: tweet.content,
      });
    const reasonCode = parsed.value.reasonCode || inferQueueFeedbackReasonCode(intentSummary);
    const stage = feedbackStage(reasonCode);
    const userProvidedFeedback = Boolean(userReason || parsed.value.reasonCode);
    const tasteFeedback = classifyTasteFeedbackReason(intentSummary, tweet.content, { voiceProfile: parseSoulMd(agent.name, agent.soulMd) });
    const idea = tweet.pipelineVersion === 'v2' && tweet.ideaId
      ? (await getIdeaCandidates(id, 500)).find((candidate) => candidate.id === tweet.ideaId) || null
      : null;
    const semanticBlock = buildSemanticBlockFromQueueFeedback({
      tweet,
      idea,
      reasonCode,
      reason: intentSummary,
      requestedScope: parsed.value.blockScope,
      permanent: parsed.value.permanent,
    });

    await saveFeedback(id, {
      tweetId: tweet.id,
      tweetText: tweet.content,
      rating: 'down',
      generatedAt: new Date().toISOString(),
      reason: userReason || undefined,
      intentSummary,
      source: 'queue_delete',
      userProvidedReason: userProvidedFeedback,
      reasonCode,
      blockScope: semanticBlock?.scope || null,
      permanentBlock: semanticBlock?.permanent || false,
      semanticKey: semanticBlock?.semanticKey || null,
    });
    await addLearningSignal(id, {
      tweetId: tweet.id,
      signalType: 'deleted_from_queue',
      surface: tweet.type === 'reply' ? 'mentions' : 'queue',
      rewardDelta: -0.75,
      reason: intentSummary,
      inferred: !userProvidedFeedback,
      metadata: metadataWithStyleMode(tweet, {
        ...buildGenerationLearningMetadata(tweet),
        ...tasteFeedback.metadata,
        userProvidedReason: userProvidedFeedback,
        feedbackReasonCode: reasonCode,
        feedbackStage: stage,
        feedbackBlockScope: semanticBlock?.scope || null,
        feedbackPermanent: semanticBlock?.permanent || false,
        feedbackSemanticKey: semanticBlock?.semanticKey || null,
        pipelineVersion: tweet.pipelineVersion || null,
        generationRunId: tweet.generationRunId || null,
        storyClusterId: tweet.storyClusterId || null,
        ideaId: tweet.ideaId || null,
        draftCandidateId: tweet.draftCandidateId || null,
        draftExperimentId: tweet.draftExperimentId ?? null,
        creativeLane: tweet.creativeLane ?? null,
        experimentHoldout: tweet.experimentHoldout === true,
      }),
    });

    if (semanticBlock) await addSemanticBlock(id, semanticBlock);
    await recordV2CandidateOutcomeForTweet(tweet, 'deleted', [`feedback:${reasonCode}`], {
      updateIdea: stage !== 'writing' || semanticBlock?.scope !== 'copy',
    });
    await deleteTweet(tweetId);
    return NextResponse.json({
      success: true,
      feedbackSource: userProvidedFeedback ? 'user' : 'inferred',
      intentSummary,
      reasonCode,
      blockScope: semanticBlock?.scope || null,
      permanentBlock: semanticBlock?.permanent || false,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to delete tweet' }, { status: 500 });
  }
}
