import { NextRequest, NextResponse } from 'next/server';
import {
  PUBLISHING_V2_CONTROL_MODEL_STACK,
  PUBLISHING_V2_MODEL_STACK,
} from '@/lib/ai';
import { buildGenerationContext } from '@/lib/generation-context';
import { generatePublishingBatchV2 } from '@/lib/publishing-v2';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import {
  acquireAutopilotLock,
  getAgent,
  getAnalysis,
  getProductFacts,
  getTrendingCache,
  releaseAutopilotLock,
  resetReadCache,
} from '@/lib/kv-storage';
import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';
import type { TrendingTopic } from '@/lib/trending';
import type {
  DraftCandidate,
  GenerationEvidenceReference,
  GenerationModelStackId,
  GenerationRunTrace,
  GenerationSurface,
  IdeaCandidate,
  PublishingGenerationRequest,
} from '@/lib/types';
const MAX_PREVIEW_COUNT = 5;
const GENERATION_SURFACES = new Set<GenerationSurface>(['original', 'reply', 'followup', 'remix', 'marketing', 'relationship']);
const ALLOWED_MODEL_STACKS = new Set<GenerationModelStackId>([
  PUBLISHING_V2_MODEL_STACK,
  PUBLISHING_V2_CONTROL_MODEL_STACK,
]);

export const maxDuration = 800;

function text(value: unknown, limit = 4000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function evidence(value: unknown): GenerationEvidenceReference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 240);
  const content = text(raw.content, 8000);
  const kind = text(raw.kind, 80) as GenerationEvidenceReference['kind'];
  const validKinds = new Set<GenerationEvidenceReference['kind']>([
    'research_source', 'target_post', 'thread_context', 'original_post', 'performance_snapshot', 'product_fact', 'remix_parent',
  ]);
  if (!id || !content || !validKinds.has(kind)) return null;
  const url = text(raw.url, 2000) || null;
  if (url) {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) return null;
    } catch {
      return null;
    }
  }
  for (const key of ['publishedAt', 'verifiedAt', 'expiresAt'] as const) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '' && !optionalDate(raw[key])) return null;
  }
  const trustTier = text(raw.trustTier, 40);
  return {
    id,
    kind,
    sourceDocumentId: text(raw.sourceDocumentId, 240) || null,
    url,
    title: text(raw.title, 500) || id,
    publisher: text(raw.publisher, 240) || null,
    content,
    publishedAt: optionalDate(raw.publishedAt),
    verifiedAt: optionalDate(raw.verifiedAt),
    expiresAt: optionalDate(raw.expiresAt),
    trustTier: trustTier === 'primary' || trustTier === 'trusted' || trustTier === 'community' ? trustTier : null,
  };
}

async function publishingRequest(body: Record<string, unknown>, agentId: string): Promise<PublishingGenerationRequest | null> {
  const surface = text(body.surface, 40) || 'original';
  if (!GENERATION_SURFACES.has(surface as GenerationSurface)) return null;
  const triggerId = text(body.triggerId, 300) || `internal-preview:${agentId}:${surface}:${Date.now()}`;
  if (surface === 'original') {
    return { surface, triggerId, requestedTopic: text(body.topic, 300) || null };
  }
  if (surface === 'reply') {
    const targetPost = evidence(body.targetPost);
    const threadContext = Array.isArray(body.threadContext)
      ? body.threadContext.map(evidence).filter((entry): entry is GenerationEvidenceReference => Boolean(entry))
      : [];
    return targetPost ? { surface, triggerId, targetPost, threadContext } : null;
  }
  if (surface === 'followup') {
    const originalPost = evidence(body.originalPost);
    const performance = evidence(body.performance);
    return originalPost && performance ? { surface, triggerId, originalPost, performance } : null;
  }
  if (surface === 'remix') {
    const parentTweetId = text(body.parentTweetId, 240);
    const direction = text(body.direction, 1000);
    const inheritedEvidence = Array.isArray(body.inheritedEvidence)
      ? body.inheritedEvidence.map(evidence).filter((entry): entry is GenerationEvidenceReference => Boolean(entry))
      : [];
    if (!parentTweetId || !direction || inheritedEvidence.length === 0) return null;
    return {
      surface,
      triggerId,
      parentTweetId,
      parentIdeaId: text(body.parentIdeaId, 240) || null,
      parentDraftId: text(body.parentDraftId, 240) || null,
      direction,
      changesClaim: body.changesClaim === true,
      inheritedEvidence,
    };
  }
  if (surface === 'marketing') {
    const productFacts = (await getProductFacts()).map((fact): GenerationEvidenceReference => ({
      id: fact.id,
      kind: 'product_fact',
      sourceDocumentId: null,
      url: fact.provenanceUrl,
      title: fact.provenanceLabel,
      publisher: `owner:${fact.verifiedByUserId}`,
      content: fact.statement,
      publishedAt: fact.verifiedAt,
      verifiedAt: fact.verifiedAt,
      expiresAt: fact.expiresAt,
      trustTier: 'primary',
    }));
    return { surface, triggerId, productFacts };
  }
  const targetPost = evidence(body.targetPost);
  const targetHandle = text(body.targetHandle, 100).replace(/^@/, '');
  return targetPost && targetHandle
    ? { surface: 'relationship', triggerId, targetPost, targetHandle }
    : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  resetReadCache();
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const requestedCount = Number(body?.count ?? 4);
  const requestedModelStack = String(body?.modelStack || PUBLISHING_V2_MODEL_STACK) as GenerationModelStackId;
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_PREVIEW_COUNT) {
    return NextResponse.json({ error: `count must be an integer from 1 to ${MAX_PREVIEW_COUNT}` }, { status: 400 });
  }
  if (!ALLOWED_MODEL_STACKS.has(requestedModelStack)) {
    return NextResponse.json({
      error: `modelStack must be ${[...ALLOWED_MODEL_STACKS].join(' or ')}`,
    }, { status: 400 });
  }
  if (body?.pipelineVersion !== undefined && String(body.pipelineVersion).trim().toLowerCase() !== 'v2') {
    return NextResponse.json({ error: 'pipelineVersion must be v2' }, { status: 400 });
  }
  const generationRequest = await publishingRequest(body as Record<string, unknown>, id);
  if (!generationRequest) {
    return NextResponse.json({ error: 'Invalid or incomplete publishing evidence for the requested surface.' }, { status: 400 });
  }

  const owner = `internal-generation-preview:${Date.now()}:${id}`;
  const lock = await acquireAutopilotLock(id, owner, 15 * 60, 'manual');
  if (!lock.acquired) {
    return NextResponse.json({
      error: 'Autopilot is already running.',
      lock: lock.lock ? { acquiredAt: lock.lock.acquiredAt, expiresAt: lock.lock.expiresAt } : null,
    }, { status: 409 });
  }

  try {
    const analysis = await getAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'Account analysis is unavailable.' }, { status: 409 });

    const context = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });
    const cachedTrending = await getTrendingCache(id);
    const trending = Array.isArray(cachedTrending) ? cachedTrending as TrendingTopic[] : [];
    let generationTrace: GenerationRunTrace | null = null;
    let previewArtifacts: { ideas: IdeaCandidate[]; drafts: DraftCandidate[] } | null = null;
    const drafts = await generatePublishingBatchV2({
          agentId: id,
          count: requestedCount,
          request: generationRequest,
          voiceProfile: context.voiceProfile,
          analysis,
          learnings: context.learnings,
          style: context.style,
          recentPosts: context.recentPosts,
          allTweets: context.allTweets,
          memory: context.memory,
          signals: context.signals,
          trending,
          modelStack: requestedModelStack,
          mode: 'preview',
          requireAutopostQuality: true,
          persistArtifacts: false,
          entitlement: await getAgentAutomationEntitlement(id, { agent }),
          onTrace: (trace) => { generationTrace = trace; },
          onArtifacts: (artifacts) => { previewArtifacts = artifacts; },
        });
    return NextResponse.json({
      agentId: id,
      pipelineVersion: 'v2',
      surface: generationRequest.surface,
      modelStack: requestedModelStack,
      requested: requestedCount,
      generated: drafts.length,
      diagnostics: null,
      generationTrace,
      candidateDiagnostics: previewArtifacts
        ? {
            ideas: previewArtifacts.ideas.map((idea) => ({
              id: idea.id,
              briefId: idea.briefId,
              storyClusterId: idea.storyClusterId,
              topic: idea.topic,
              claim: idea.claim,
              tension: idea.tension,
              implication: idea.implication,
              authorReason: idea.authorReason,
              evidenceIds: idea.evidenceIds,
              status: idea.status,
              rejectionCodes: idea.rejectionCodes,
              judgeScore: idea.judgeScore,
              judgeBreakdown: idea.judgeBreakdown || null,
            })),
            drafts: previewArtifacts.drafts.map((draft) => ({
              id: draft.id,
              ideaId: draft.ideaId,
              storyClusterId: draft.storyClusterId,
              content: draft.content,
              format: draft.format,
              posture: draft.posture,
              status: draft.status,
              rejectionCodes: draft.rejectionCodes,
              evidenceIds: draft.evidenceIds,
              judgeProvider: draft.judgeProvider,
              judgeModel: draft.judgeModel,
              judgeScore: draft.judgeScore,
              judgeBreakdown: draft.judgeBreakdown || null,
              mutationRound: draft.mutationRound,
            })),
          }
        : null,
      drafts: drafts.map((draft) => {
        return {
          content: draft.content,
          pipelineVersion: draft.pipelineVersion || 'v2',
          generationRunId: draft.generationRunId || null,
          storyClusterId: draft.storyClusterId || null,
          ideaId: draft.ideaId || null,
          draftCandidateId: draft.draftCandidateId || null,
          parentTweetId: draft.parentTweetId || null,
          parentIdeaId: draft.parentIdeaId || null,
          parentDraftCandidateId: draft.parentDraftCandidateId || null,
          evidenceReferences: draft.evidenceReferences || [],
          generationEvidenceReferences: draft.generationEvidenceReferences || [],
          topic: draft.targetTopic,
          generationModelStack: draft.generationModelStack || requestedModelStack,
          generationProvider: draft.generationProvider || null,
          generationModel: draft.generationModel || null,
          judgeProvider: draft.judgeProvider || null,
          judgeModel: draft.judgeModel || null,
          finalCriticProvider: draft.finalCriticProvider || null,
          finalCriticModel: draft.finalCriticModel || null,
          finalCriticVerdict: draft.finalCriticVerdict || null,
          finalCriticScores: draft.finalCriticScores || null,
          finalCriticVersion: draft.finalCriticVersion || null,
          qualityPolicyVersion: draft.qualityPolicyVersion || null,
          voiceCorpusVersion: draft.voiceCorpusVersion || null,
          mutationRound: draft.mutationRound || null,
          candidateScore: draft.candidateScore,
          confidenceScore: draft.confidenceScore,
          judgeScore: draft.judgeScore,
          judgeNotes: draft.judgeNotes || null,
          slopScore: draft.slopScore,
          sourceBrief: draft.sourceBrief || null,
          sourceLane: draft.sourceLane || null,
          trendTopicId: draft.trendTopicId || null,
        };
      }),
    });
  } finally {
    await releaseAutopilotLock(id, lock.owner).catch(() => false);
  }
}
