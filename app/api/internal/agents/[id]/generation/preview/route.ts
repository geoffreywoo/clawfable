import { NextRequest, NextResponse } from 'next/server';
import { assessAccountTaste, getAutonomousQueueTasteIssue } from '@/lib/account-taste';
import {
  GEOFFREY_CONTROL_MODEL_STACK,
  GEOFFREY_PRIMARY_MODEL_STACK,
  GEOFFREY_STRICT_FALLBACK_MODEL_STACK,
} from '@/lib/ai';
import { buildGenerationContext } from '@/lib/generation-context';
import { getGenerationPipelineVersion } from '@/lib/generation-pipeline';
import { generateTweetBatchV2 } from '@/lib/generation-v2';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { assessGeoffreyQualityPolicy } from '@/lib/quality-policy';
import {
  acquireAutopilotLock,
  getAgent,
  getAnalysis,
  getTrendingCache,
  releaseAutopilotLock,
  resetReadCache,
} from '@/lib/kv-storage';
import { generateViralBatch, type ViralGenerationDiagnostics } from '@/lib/viral-generator';
import type { TrendingTopic } from '@/lib/trending';
import type { GenerationModelStackId, GenerationRunTrace } from '@/lib/types';
import { isGeoffreyDeepTechnicalTopic } from '@/lib/source-planner';

const MAX_PREVIEW_COUNT = 8;
const ALLOWED_MODEL_STACKS = new Set<GenerationModelStackId>([
  GEOFFREY_PRIMARY_MODEL_STACK,
  GEOFFREY_CONTROL_MODEL_STACK,
  GEOFFREY_STRICT_FALLBACK_MODEL_STACK,
]);

export const maxDuration = 800;

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
  const requestedModelStack = String(body?.modelStack || GEOFFREY_PRIMARY_MODEL_STACK) as GenerationModelStackId;
  const requestedPipelineVersion = body?.pipelineVersion === undefined
    ? undefined
    : String(body.pipelineVersion).trim().toLowerCase();
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_PREVIEW_COUNT) {
    return NextResponse.json({ error: `count must be an integer from 1 to ${MAX_PREVIEW_COUNT}` }, { status: 400 });
  }
  if (!ALLOWED_MODEL_STACKS.has(requestedModelStack)) {
    return NextResponse.json({
      error: `modelStack must be ${[...ALLOWED_MODEL_STACKS].join(' or ')}`,
    }, { status: 400 });
  }
  if (requestedPipelineVersion && requestedPipelineVersion !== 'v1' && requestedPipelineVersion !== 'v2') {
    return NextResponse.json({ error: 'pipelineVersion must be v1 or v2' }, { status: 400 });
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
    const pipelineVersion = getGenerationPipelineVersion(agent.handle, requestedPipelineVersion);
    const diagnostics: ViralGenerationDiagnostics | undefined = pipelineVersion === 'v1' && body?.includeDiagnostics === true ? {} : undefined;
    let generationTrace: GenerationRunTrace | null = null;
    const drafts = pipelineVersion === 'v2'
      ? await generateTweetBatchV2({
          agentId: id,
          count: requestedCount,
          requestedTopic: typeof body?.topic === 'string' ? body.topic : null,
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
          persistArtifacts: false,
          onTrace: (trace) => { generationTrace = trace; },
        })
      : await generateViralBatch(
          context.voiceProfile,
          analysis,
          requestedCount,
          trending,
          context.learnings,
          agent.soulMd,
          context.style,
          context.recentPosts,
          context.allTweets,
          context.memory,
          context.ideaAtoms,
          context.signals,
          diagnostics,
          { modelStack: requestedModelStack },
        );
    return NextResponse.json({
      agentId: id,
      pipelineVersion,
      modelStack: requestedModelStack,
      requested: requestedCount,
      generated: drafts.length,
      diagnostics: diagnostics || null,
      generationTrace,
      drafts: drafts.map((draft) => {
        const taste = assessAccountTaste(draft.content, {
          voiceProfile: context.voiceProfile,
          learnings: context.learnings,
          memory: context.memory,
          featureTags: draft.featureTags,
          sourceTexts: draft.sourceEvidenceTexts || [],
        });
        const quality = assessGeoffreyQualityPolicy(draft, {
          voiceProfile: context.voiceProfile,
          learnings: context.learnings,
          memory: context.memory,
          stage: 'queue',
        });
        const queueIssue = getAutonomousQueueTasteIssue({
          voiceProfile: context.voiceProfile,
          assessment: taste,
          anchorCopyRiskContribution: draft.scoreProvenance?.anchorCopyRisk,
          hasSourceContext: Boolean(draft.sourceBrief || draft.trendHeadline),
          technicalLane: isGeoffreyDeepTechnicalTopic(`${draft.targetTopic || ''} ${draft.trendHeadline || ''} ${draft.content}`),
        });

        return {
          content: draft.content,
          pipelineVersion: draft.pipelineVersion || pipelineVersion,
          generationRunId: draft.generationRunId || null,
          storyClusterId: draft.storyClusterId || null,
          ideaId: draft.ideaId || null,
          draftCandidateId: draft.draftCandidateId || null,
          evidenceReferences: draft.evidenceReferences || [],
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
          qualityEligible: quality.eligible,
          qualityIssues: quality.issues,
          qualityScores: quality.scores,
          mutationRound: draft.mutationRound || null,
          candidateScore: draft.candidateScore,
          confidenceScore: draft.confidenceScore,
          judgeScore: draft.judgeScore,
          judgeNotes: draft.judgeNotes || null,
          slopScore: draft.slopScore,
          nativeVoiceScore: taste.nativeVoiceScore,
          casualStartupScore: taste.casualStartupScore,
          stiffnessRisk: taste.stiffnessRisk,
          technicalCredibilityScore: taste.technicalCredibilityScore,
          cringeRisk: taste.cringeRisk,
          generatedPatternRisk: taste.generatedPatternRisk,
          tasteAction: taste.action,
          tasteNotes: taste.notes,
          queueIssue,
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
