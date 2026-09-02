import { NextRequest, NextResponse } from 'next/server';
import { addRemixEntry, checkRateLimit, getAnalysis, getTweet, updateTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { PUBLISHING_V2_MODEL_STACK } from '@/lib/ai';
import { buildGenerationContext } from '@/lib/generation-context';
import { generatePublishingBatchV2 } from '@/lib/publishing-v2';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';
import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { getAccountPublishingPolicyIssue } from '@/lib/account-publish-policy';
import { getTweetCompletenessIssue } from '@/lib/survivability';
import { readJsonObjectBody } from '@/lib/request-validation';
import type { GenerationEvidenceReference } from '@/lib/types';

const REMIX_DIRECTIONS: Record<string, string> = {
  shorter: 'Make it shorter and punchier without changing the claim.',
  longer: 'Expand the analysis using only inherited evidence.',
  spicier: 'Sharpen the delivery without strengthening or changing the claim.',
  softer: 'Make the delivery more thoughtful and nuanced without changing the claim.',
  funnier: 'Add wit without changing the claim or factual scope.',
  data: 'Reframe around concrete evidence that already exists in the inherited sources.',
  question: 'Express the same claim as a useful question.',
  contrarian: 'Forge and qualify a new opposing judgment.',
};

const COPY_ONLY_DIRECTIONS = new Set(['shorter', 'spicier', 'softer', 'funnier', 'question']);

function inheritedEvidence(tweet: NonNullable<Awaited<ReturnType<typeof getTweet>>>): GenerationEvidenceReference[] {
  const evidence: GenerationEvidenceReference[] = [
    {
      id: `remix-parent:${tweet.id}`,
      kind: 'remix_parent',
      sourceDocumentId: null,
      url: tweet.xTweetId ? `https://x.com/i/status/${tweet.xTweetId}` : null,
      title: 'Parent draft',
      publisher: null,
      content: tweet.content,
      publishedAt: tweet.postedAt || tweet.createdAt,
      verifiedAt: new Date().toISOString(),
      expiresAt: null,
      trustTier: 'primary',
    },
    ...(tweet.generationEvidenceReferences || []),
    ...(tweet.evidenceReferences || []).map((entry) => ({
      id: `source:${entry.sourceDocumentId}`,
      kind: 'research_source' as const,
      sourceDocumentId: entry.sourceDocumentId,
      url: entry.url,
      title: entry.title,
      publisher: entry.publisher,
      content: entry.claim || entry.title,
      publishedAt: entry.publishedAt,
      verifiedAt: entry.publishedAt,
      expiresAt: null,
      trustTier: entry.trustTier,
    })),
  ];
  return evidence.filter((entry, index) => evidence.findIndex((candidate) => candidate.id === entry.id) === index);
}

// POST /api/agents/[id]/remix
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
    const tweetId = typeof body.tweetId === 'string' ? body.tweetId : '';
    const direction = typeof body.direction === 'string' ? body.direction : '';
    const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt.trim() : '';
    if (!tweetId) return NextResponse.json({ error: 'tweetId required' }, { status: 400 });

    const existingTweet = await getTweet(tweetId);
    if (!existingTweet || String(existingTweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found for this agent' }, { status: 404 });
    }
    const parentLineageIssue = getGeneratedPublishIssue(existingTweet);
    if (parentLineageIssue) {
      return NextResponse.json({
        error: `This draft cannot seed a V2 remix: ${parentLineageIssue}`,
        code: 'invalid_remix_parent_lineage',
      }, { status: 409 });
    }
    const instruction = customPrompt || REMIX_DIRECTIONS[direction];
    if (!instruction) {
      return NextResponse.json({ error: 'direction or customPrompt required' }, { status: 400 });
    }

    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'Run account analysis before remixing drafts.' }, { status: 409 });
    }
    const context = await buildGenerationContext(agent, {
      negativeLimit: 6,
      directiveLimit: 10,
    });
    const entitlement = await getAgentAutomationEntitlement(id, { agent });
    if (!entitlement.eligible && !(await checkRateLimit(id, 'unpaid_preview_generation', 5))) {
      return NextResponse.json({ error: 'Free preview limit reached. Try again later.' }, { status: 429 });
    }
    const changesClaim = Boolean(customPrompt) || !COPY_ONLY_DIRECTIONS.has(direction);
    const [candidate] = await generatePublishingBatchV2({
      agentId: id,
      count: 1,
      request: {
        surface: 'remix',
        triggerId: `${tweetId}:${direction || 'custom'}:${instruction}`,
        parentTweetId: tweetId,
        parentIdeaId: existingTweet.ideaId || null,
        parentDraftId: existingTweet.draftCandidateId || null,
        direction: instruction,
        changesClaim,
        inheritedEvidence: inheritedEvidence(existingTweet),
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
      mode: entitlement.eligible ? 'manual' : 'preview',
      entitlement,
    });
    if (!candidate) {
      return NextResponse.json({
        error: 'No remix cleared the inherited-evidence, originality, and voice gates.',
        code: 'no_qualified_remix',
      }, { status: 422 });
    }

    // A remix of a queued draft inherits the parent's lifecycle: the child
    // becomes the queued item and the parent is quarantined, mirroring the
    // immutable-child rule for operator edits. Queue gates run first so a
    // remix can never bypass them.
    const supersedeQueuedParent = existingTweet.status === 'queued' && entitlement.eligible;
    if (supersedeQueuedParent) {
      const completenessIssue = getTweetCompletenessIssue(candidate.content);
      if (completenessIssue) {
        return NextResponse.json({ error: completenessIssue, code: 'remix_incomplete' }, { status: 422 });
      }
      if (existingTweet.type !== 'reply') {
        const publishingPolicyIssue = getAccountPublishingPolicyIssue({
          handle: agent.handle,
          content: candidate.content,
          topic: existingTweet.topic,
          portfolioCompanyContext: candidate.portfolioCompanyContext ?? existingTweet.portfolioCompanyContext,
        });
        if (publishingPolicyIssue) {
          return NextResponse.json({ error: publishingPolicyIssue, code: 'account_publish_policy' }, { status: 422 });
        }
      }
    }
    const child = await createTweetFromGeneratedCandidate(id, candidate, {
      status: supersedeQueuedParent ? 'queued' : entitlement.eligible ? 'draft' : 'preview',
      type: existingTweet.type === 'reply' || existingTweet.type === 'quote' ? existingTweet.type : 'original',
      topic: existingTweet.topic || 'remix',
      followupForTweetId: existingTweet.followupForTweetId || null,
      replyConversationId: existingTweet.replyConversationId || null,
    });
    if (supersedeQueuedParent) {
      await updateTweet(existingTweet.id, {
        status: 'quarantined',
        preQuarantineStatus: 'queued',
        quarantinedAt: new Date().toISOString(),
        quarantineReason: `Superseded by remix child ${child.id}.`,
      });
    }
    await addRemixEntry(id, {
      direction: direction || 'custom',
      customPrompt: customPrompt || undefined,
      originalContent: existingTweet.content,
      remixedContent: child.content,
      ts: new Date().toISOString(),
    });

    return NextResponse.json({
      content: child.content,
      direction: direction || 'custom',
      tweet: child,
      parentTweetId: tweetId,
      supersededParent: supersedeQueuedParent,
      changesClaim,
      previewLimited: !entitlement.eligible,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Remix failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
