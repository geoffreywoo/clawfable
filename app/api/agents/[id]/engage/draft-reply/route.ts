import { NextRequest, NextResponse } from 'next/server';
import { resolvePublishingV2ModelStacks } from '@/lib/ai';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { buildEngagementDraft } from '@/lib/engagement';
import { getAnalysis, addLearningSignal } from '@/lib/kv-storage';
import type { EngagementCandidate, GenerationEvidenceReference } from '@/lib/types';
import { hasPostedReplyForConversation } from '@/lib/reply-conversation-guard';
import { areRepliesDisabled, REPLY_AUTOMATION_DISABLED_REASON } from '@/lib/reply-safety';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';
import { generatePublishingBatchV2 } from '@/lib/publishing-v2';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';
import { readJsonObjectBody } from '@/lib/request-validation';

function validCandidate(candidate: Partial<EngagementCandidate> | null | undefined, agentId: string): candidate is EngagementCandidate {
  return !!candidate
    && typeof candidate.tweetId === 'string'
    && typeof candidate.tweetUrl === 'string'
    && typeof candidate.authorHandle === 'string'
    && typeof candidate.text === 'string'
    && typeof candidate.createdAt === 'string'
    && String(candidate.agentId) === String(agentId);
}

// POST /api/agents/[id]/engage/draft-reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { agent, user } = await requireAgentAccess(id);
    const entitlement = await assertAgentAutomationEntitlement(id, { agent, user });
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
    const candidate = body?.candidate as Partial<EngagementCandidate> | undefined;

    if (!validCandidate(candidate, id)) {
      return NextResponse.json({ error: 'candidate is required' }, { status: 400 });
    }
    if (areRepliesDisabled()) {
      return NextResponse.json({
        error: REPLY_AUTOMATION_DISABLED_REASON,
        code: 'reply_emergency_disabled',
      }, { status: 503 });
    }
    if (await hasPostedReplyForConversation(id, candidate.tweetId)) {
      return NextResponse.json({
        error: 'This account has already replied to that root conversation.',
        code: 'duplicate_reply_conversation',
      }, { status: 409 });
    }

    const [context, analysis] = await Promise.all([
      buildGenerationContext(agent, {
        negativeLimit: 6,
        directiveLimit: 10,
      }),
      getAnalysis(id),
    ]);
    if (!analysis) {
      return NextResponse.json({ error: 'Run account analysis before generating replies.' }, { status: 409 });
    }

    const targetPost: GenerationEvidenceReference = {
      id: `x-post:${candidate.tweetId}`,
      kind: 'target_post',
      sourceDocumentId: null,
      url: candidate.tweetUrl,
      title: `Post by @${candidate.authorHandle.replace(/^@/, '')}`,
      publisher: candidate.authorHandle.replace(/^@/, ''),
      content: candidate.text,
      publishedAt: candidate.createdAt,
      verifiedAt: new Date().toISOString(),
      expiresAt: null,
      trustTier: 'community',
    };
    const [generated] = await generatePublishingBatchV2({
      agentId: id,
      count: 1,
      request: {
        surface: 'reply',
        triggerId: candidate.tweetId,
        targetPost,
      },
      voiceProfile: context.voiceProfile,
      analysis,
      learnings: context.learnings,
      style: context.style,
      recentPosts: context.recentPosts,
      allTweets: context.allTweets,
      memory: context.memory,
      signals: context.signals,
      trending: null,
      modelStack: resolvePublishingV2ModelStacks(agent.handle).activeStack,
      mode: 'manual',
      entitlement,
    });
    if (!generated) {
      return NextResponse.json({
        error: 'No reply cleared the context, safety, originality, and voice gates.',
        code: 'no_qualified_reply',
      }, { status: 422 });
    }

    const tweet = await createTweetFromGeneratedCandidate(id, generated, {
      status: 'draft',
      type: 'reply',
      topic: `Engage reply to @${candidate.authorHandle.replace(/^@/, '')}`,
      followupForTweetId: candidate.tweetId,
      replyConversationId: candidate.tweetId,
    });

    await addLearningSignal(id, {
      tweetId: tweet.id,
      xTweetId: candidate.tweetId,
      signalType: 'reply_generated',
      surface: 'engage',
      rewardDelta: 0.1,
      metadata: {
        targetHandle: candidate.authorHandle,
        targetTweetId: candidate.tweetId,
        candidateScore: candidate.score,
        generationRunId: generated.generationRunId || null,
        ideaId: generated.ideaId || null,
      },
    });

    return NextResponse.json({
      tweet,
      draft: buildEngagementDraft(tweet),
      candidate,
    });
  } catch (err) {
    if (err instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(err), { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate engage reply';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
