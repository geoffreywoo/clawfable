import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { PUBLISHING_V2_MODEL_STACK } from '@/lib/ai';
import { hasPostedReplyForConversation, normalizeTweetTarget } from '@/lib/reply-conversation-guard';
import { areRepliesDisabled, REPLY_AUTOMATION_DISABLED_REASON } from '@/lib/reply-safety';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';
import { generatePublishingBatchV2 } from '@/lib/publishing-v2';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';
import type { GenerationEvidenceReference } from '@/lib/types';
import { readJsonObjectBody } from '@/lib/request-validation';

// POST /api/agents/[id]/generate-reply
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
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    const authorHandle = typeof body?.authorHandle === 'string' ? body.authorHandle.trim() : '';
    const targetTweetId = normalizeTweetTarget(body?.targetTweetId || body?.tweetId || body?.replyToId);
    const replyConversationId = normalizeTweetTarget(body?.conversationId) || targetTweetId;
    if (!content || !authorHandle || !targetTweetId) {
      return NextResponse.json({ error: 'content, authorHandle, and targetTweetId required' }, { status: 400 });
    }
    if (areRepliesDisabled()) {
      return NextResponse.json({
        error: REPLY_AUTOMATION_DISABLED_REASON,
        code: 'reply_emergency_disabled',
      }, { status: 503 });
    }
    if (await hasPostedReplyForConversation(id, replyConversationId)) {
      return NextResponse.json({
        error: 'This account has already replied to that root conversation.',
        code: 'duplicate_reply_conversation',
      }, { status: 409 });
    }

    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'Run account analysis before generating replies.' }, { status: 409 });
    }
    const context = await buildGenerationContext(agent, {
      negativeLimit: 5,
      directiveLimit: 10,
    });
    const normalizedAuthor = authorHandle.replace(/^@/, '');
    const targetPost: GenerationEvidenceReference = {
      id: `x-post:${targetTweetId}`,
      kind: 'target_post',
      sourceDocumentId: null,
      url: `https://x.com/${normalizedAuthor}/status/${targetTweetId}`,
      title: `Post by @${normalizedAuthor}`,
      publisher: normalizedAuthor,
      content,
      publishedAt: null,
      verifiedAt: new Date().toISOString(),
      expiresAt: null,
      trustTier: 'community',
    };
    const [candidate] = await generatePublishingBatchV2({
      agentId: id,
      count: 1,
      request: {
        surface: 'reply',
        triggerId: targetTweetId,
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
      modelStack: PUBLISHING_V2_MODEL_STACK,
      mode: 'manual',
      entitlement,
    });
    if (!candidate) {
      return NextResponse.json({
        error: 'No reply cleared the context, safety, originality, and voice gates.',
        code: 'no_qualified_reply',
      }, { status: 422 });
    }

    const tweet = await createTweetFromGeneratedCandidate(id, candidate, {
      status: 'draft',
      type: 'reply',
      topic: `Reply to @${normalizedAuthor}`,
      followupForTweetId: targetTweetId,
      replyConversationId,
    });
    return NextResponse.json(tweet);
  } catch (err) {
    if (err instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(err), { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate reply';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
