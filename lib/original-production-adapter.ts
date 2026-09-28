import {
  buildGenerationBriefsV2, prioritizeCurrentInterestBriefsV2, normalizeIdeaCandidatesV2,
  normalizeDraftContentV2, preflightDraft, qualifyOriginalDrafts, collectOperatorAnchors,
  sourceDocumentsForBrief, briefForIdea, getGenerationPolicyVersions, countRejections, finalizeTrace, isStoryEditoriallyQualifiedV2,
  type GenerateTweetBatchV2Input, type GenerationBriefV2, type DraftEvaluation,
} from './generation-v2';
import { runOriginalProduction } from './original-production';
import { runOriginalModelStage, type OriginalModelOptions } from './original-model-stage';
import { hasOriginalModelJudgment, ORIGINAL_PAID_RECOVERY_KEY, type OriginalPaidRecovery } from './original-paid-recovery';
import { buildOriginalEditorialContext, contextForOriginalMode, type OriginalEditorialContext } from './original-editorial-context';
import { buildOriginalIdeationPrompt, buildOriginalWritingPrompt } from './original-prompts';
import { buildSubjectPacket } from './subject-packet';
import { isCurrentSourceEvidence } from './source-validity';
import { getOwnerAuthorshipAttestation, normalizedAuthorshipText } from './owner-authorship';
import {
  getSourceDocuments, getStoryClusters, getSemanticBlocks, getIdeaCandidates, getDynamicIdeaSeeds,
  getDraftCandidates, getTweets, saveGenerationRun, upsertIdeaCandidates, upsertDraftCandidates,
} from './kv-storage';
import { aiSpendContext, releaseAiCompletionHold } from './ai-budget';
import { normalizeCandidateDisposition } from './candidate-disposition';
import { jobFingerprint } from './generation-job';
import { stableResearchId } from './research-utils';
import type { DraftCandidate, IdeaCandidate, GenerationModelCallTrace, GenerationRunTrace, SourceDocument } from './types';
import type { RankedPublishingCandidate } from './publishing-candidate';

export const ORIGINAL_PRODUCTION_VERSION = 'simple-original-3';
type Subject = GenerationBriefV2 & { editorialContext: OriginalEditorialContext };
function parseArray(text: string, field: string): Array<Record<string, any>> {
  try {
    const values = JSON.parse(text)?.[field];
    if (Array.isArray(values) && values.every(row => row && typeof row === 'object' && !Array.isArray(row))) return values;
  } catch { /* Keep malformed paid output pending without buying another call. */ }
  throw new Error('malformed_output');
}

/** Validate the live evidence, not merely the once-valid job snapshot. */
export function validateOriginalSubjects(subjects: GenerationBriefV2[], frozen: SourceDocument[], current: SourceDocument[], now = Date.now(), selectedIdea?: Pick<IdeaCandidate, 'briefId'>) {
  const required = selectedIdea ? subjects.filter(subject => subject.id === selectedIdea.briefId) : subjects;
  if (selectedIdea && required.length !== 1) throw new Error('stale_evidence');
  for (const subject of required) {
    if (!subject.subjectPacket || !(Date.parse(subject.subjectPacket.expiresAt) > now)) throw new Error('subject_expired');
    for (const id of subject.sourceDocumentIds) {
      const original = frozen.find(source => source.id === id), live = current.find(source => source.id === id);
      if (!original || !live || !isCurrentSourceEvidence(live, now) || live.contentHash !== original.contentHash) throw new Error('stale_evidence');
    }
  }
}

/** Three paid stages, one funded idea, no recursive rescue path. */
export async function generateOriginalProduction(input: GenerateTweetBatchV2Input): Promise<RankedPublishingCandidate[]> {
  const session = input.jobSession;
  if (!session) throw new Error('generation_session_required');
  const startedAt = Date.now(), deadlineAt = startedAt + 240_000;
  const runId = session.job.id;
  const policy = getGenerationPolicyVersions(input.voiceProfile, 'original');
  let ideas: IdeaCandidate[] = [], drafts: DraftCandidate[] = [];
  let trace: GenerationRunTrace = {
    schemaVersion: 2, id: runId, agentId: input.agentId, pipelineVersion: 'v2',
    generationPolicyVersion: ORIGINAL_PRODUCTION_VERSION, qualityPolicyVersion: policy.qualityPolicyVersion,
    voiceCorpusVersion: input.learnings?.voiceCorpus?.snapshotId || null, mode: input.mode || 'live', surface: 'original',
    triggerId: input.triggerId || null, idempotencyKey: input.idempotencyKey || null, parentIdeaId: null, parentDraftId: null,
    entitlement: input.entitlement || null, requestedCount: input.count, outcomeCode: null, inputFingerprint: null,
    sourceDocumentIds: [], storyClusterIds: [], ideaCandidateIds: [], draftCandidateIds: [], selectedDraftIds: [],
    stageCounts: { budgetedCount: 1 }, rejectionCounts: {}, modelCalls: [], totalInputTokens: 0, totalOutputTokens: 0,
    estimatedCostUsd: null, startedAt: new Date(startedAt).toISOString(), completedAt: null, durationMs: null, status: 'running', error: null,
  };
  const record = async () => {
    trace.modelCalls = structuredClone(session.job.checkpoints.callHistory as GenerationModelCallTrace[] || []);
    trace.ideaCandidateIds = ideas.map(idea => idea.id);
    trace.draftCandidateIds = drafts.map(draft => draft.id);
    trace.rejectionCounts = countRejections(ideas, drafts);
    trace.stageCounts = { ...trace.stageCounts, ideasGenerated: ideas.length, ideasEligible: ideas.filter(i => i.status !== 'rejected').length,
      ideasSelected: ideas.filter(i => i.status === 'selected').length, draftsGenerated: drafts.length,
      draftsSelected: trace.selectedDraftIds.length, ideaGenerationCalls: trace.modelCalls.filter(c => c.stage === 'idea_generation').length,
      ideaJudgmentCalls: 0, writingCalls: trace.modelCalls.filter(c => c.stage === 'tweet_writing').length,
      finalJudgmentCalls: trace.modelCalls.filter(c => c.stage === 'copy_judgment').length, retryUsed: 0 };
    if (trace.status !== 'running') trace = finalizeTrace(trace);
    input.onArtifacts?.({ ideas, drafts }); input.onTrace?.(trace);
    await saveGenerationRun(input.agentId, trace);
  };
  const call = async (stage: GenerationModelCallTrace['stage'], options: OriginalModelOptions) => runOriginalModelStage({
    session, stage, options, deadlineAt,
    spendContext: { ...aiSpendContext(input.agentId, 'generation', runId, 3), ...input.spendContext,
      downstreamReserveUsd: stage === 'idea_generation' ? 1.1 : stage === 'tweet_writing' ? .3 : 0 },
  });
  // Isolate the unchanged production decision policy behind one adapter. It
  // cannot retry, purchase rewrites, or silently switch to the candidate policy.
  const assessmentInput: GenerateTweetBatchV2Input = { ...input, count: 1,
    originalModelCall: async (stage, options) => call(stage, { ...options, timeoutMs: 90_000 }),
  };
  await session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, originalProductionVersion: ORIGINAL_PRODUCTION_VERSION } }));
  try {
    if (input.entitlement?.eligible !== true) throw new Error('payment_required');
    if (input.learnings?.voiceCorpus?.active !== true) throw new Error('voice_not_ready');
    if (input.count <= 0) { trace.status = 'empty'; trace.outcomeCode = 'no_qualified_context'; await record(); return []; }
    const context = await session.checkpoint('context', () => Promise.all([
      getSourceDocuments(input.agentId, 300), getStoryClusters(input.agentId, 200), getSemanticBlocks(input.agentId),
      getIdeaCandidates(input.agentId, 300), getDynamicIdeaSeeds(input.agentId),
    ]));
    const [documents, stories, , recentIdeas, dynamicIdeaSeeds] = context;
    const [currentTweets, blocks, knownDrafts] = await Promise.all([
      getTweets(input.agentId), getSemanticBlocks(input.agentId), getDraftCandidates(input.agentId, 1000),
    ]);
    input = { ...input, allTweets: currentTweets, recentPosts: [...new Set([
      ...currentTweets.filter(tweet => tweet.status === 'posted' || tweet.status === 'deleted_from_x').map(tweet => tweet.content),
      ...input.recentPosts,
    ])] };
    assessmentInput.allTweets = input.allTweets; assessmentInput.recentPosts = input.recentPosts;
    const validate = async (subjects: Subject[], selectedIdea?: IdeaCandidate) => {
      validateOriginalSubjects(subjects, documents, await getSourceDocuments(input.agentId, 300), Date.now(), selectedIdea);
      const required = selectedIdea ? subjects.filter(subject => subject.id === selectedIdea.briefId) : subjects;
      const liveStories = await getStoryClusters(input.agentId, 200);
      if (required.some(subject => subject.storyClusterId && !liveStories.some(story => story.id === subject.storyClusterId && isStoryEditoriallyQualifiedV2(story) && !story.blockReason))) throw new Error('stale_evidence');
    };
    const prepareSubjects = async (briefs: GenerationBriefV2[], preservePackets = false): Promise<Subject[]> => {
        const attestation = await getOwnerAuthorshipAttestation(input.agentId);
        const anchors = collectOperatorAnchors(input);
        const references = input.learnings?.operatorVoiceReference;
        const referenceRows = [...references?.pinnedExamples || [], ...references?.startupRegisterExamples || [], ...references?.bestPerformers || []];
        const generatedText = new Set([...input.allTweets.map(t => t.content), ...knownDrafts.map(d => d.content)].map(normalizedAuthorshipText));
        const examples = anchors.flatMap(anchor => {
          const row = referenceRows.find(r => r.content.trim() === anchor.content.trim());
          if (!row || generatedText.has(normalizedAuthorshipText(row.content))) return [];
          return [{ id: anchor.id, content: anchor.content, provenance: row.authorshipProvenance || 'unknown' as const,
            dispositions: row.voiceCorpusDispositions || [], authorshipAttestationId: attestation?.id }];
        });
        return briefs.map(brief => {
          const subjectPacket = preservePackets ? structuredClone(brief.subjectPacket) : buildSubjectPacket(brief, documents, session.job.createdAt);
          if (!subjectPacket) throw new Error('stale_evidence');
          const editorialContext = buildOriginalEditorialContext({ voiceProfile: input.voiceProfile, subject: subjectPacket,
            contentMode: brief.evidenceMode === 'operator_opinion' ? 'opinion' : 'observation', voiceExamples: examples,
            previousPremises: input.recentPosts, portfolioCompanyContext: brief.portfolioCompanyContext,
            verifiedEntityMentions: brief.verifiedEntityMentions });
          if (editorialContext.voiceExamples.length < Math.max(1, Math.min(3, input.learnings?.voiceCorpus?.minimumAnchorCount || 3))) throw new Error('voice_not_ready');
          return { ...brief, subjectPacket, editorialContext };
        });
    };
    const preflight = (draft: DraftCandidate, idea: IdeaCandidate, subject: Subject) => {
      const brief = briefForIdea(subject, idea)!;
      return preflightDraft({ draft, idea, brief, documents: sourceDocumentsForBrief(brief, documents),
        anchors: subject.editorialContext.exampleRefs.map((e, i) => ({ id: e.id, content: subject.editorialContext.voiceExamples[i], topic: idea.topic })),
        input: assessmentInput, blocks });
    };
    const recovery = session.job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] as OriginalPaidRecovery | undefined;
    if (recovery?.version === 1 && session.job.checkpoints.paidRecoveryPolicy !== session.job.policy
      && !session.job.checkpoints.ideas_ready && !session.job.checkpoints.subjects_ready) {
      const subjects: Subject[] = [];
      for (const frozen of recovery.subjects) {
        try {
          // Preserve original evidence clocks; one stale runner-up cannot discard
          // still-valid paid work on another subject.
          await validate([frozen as Subject]);
          subjects.push(...await prepareSubjects([frozen], true));
        } catch (error) {
          if (!['stale_evidence', 'subject_expired'].includes(error instanceof Error ? error.message : '')) throw error;
        }
      }
      const persisted = currentTweets.filter(tweet => ['queued', 'posted', 'deleted_from_x', 'draft'].includes(tweet.status));
      const persistedDraftIds = new Set(persisted.map(tweet => tweet.draftCandidateId).filter(Boolean));
      const excluded = new Set([...recovery.excludedIdeaIds, ...(session.job.checkpoints.queuedIdeas as string[] || []),
        ...persisted.map(tweet => tweet.ideaId).filter(Boolean),
        ...knownDrafts.filter(draft => ['rejected', 'selected', 'reserve'].includes(draft.status)
          && hasOriginalModelJudgment(draft)).map(draft => draft.ideaId)]);
      for (const entry of recovery.entries) {
        if (entry.drafts.some(row => persistedDraftIds.has(row.draft.id) || hasOriginalModelJudgment(row.draft))
          || entry.assessment?.drafts.some(row => hasOriginalModelJudgment(row.draft))) excluded.add(entry.idea.id);
      }
      const retained = recovery.ideas.filter(idea => !excluded.has(idea.id) && subjects.some(subject => subject.id === idea.briefId));
      const normalized = normalizeIdeaCandidatesV2({ raw: retained.map(idea => ({ ...idea })), agentId: input.agentId, runId, briefs: subjects,
        voiceProfile: input.voiceProfile, recentPosts: input.recentPosts, blocks, documents, simpleContract: true,
        surface: 'original', now: new Date(session.job.createdAt).toISOString() });
      const recoveredIdeas = normalized.flatMap(idea => {
        const previous = retained.filter(row => row.briefId === idea.briefId && row.publicMove === idea.publicMove);
        return previous.length === 1 ? [{ ...idea, id: previous[0].id, supportingReasoning: previous[0].supportingReasoning,
          generatorRankScore: previous[0].generatorRankScore }] : [];
      });
      const paidDrafts: Record<string, DraftEvaluation[]> = {}, recoveryIds: string[] = [];
      for (const entry of recovery.entries) {
        const idea = recoveredIdeas.find(row => row.id === entry.idea.id && row.status !== 'rejected');
        const subject = subjects.find(row => row.id === idea?.briefId);
        if (!idea || !subject) continue;
        const evaluations = entry.drafts.map(row => {
          const current = preflight({ ...structuredClone(row.draft), status: 'generated', rejectionCodes: [], failureCategory: undefined }, idea, subject);
          if (current.draft.content !== row.draft.content) throw new Error('frozen_copy_changed_by_preflight');
          return current;
        });
        if (!session.job.checkpoints[`drafts_ready:${idea.id}`]) paidDrafts[`drafts_ready:${idea.id}`] = evaluations;
        if (evaluations.some(row => row.draft.status !== 'rejected')) recoveryIds.push(idea.id);
      }
      // Seed the ordinary stages atomically. This is recovery of paid inputs,
      // never permission to reuse an old assessment or reset attempt history.
      await session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, subjects_ready: subjects, briefs: subjects,
        ideas_ready: recoveredIdeas, ...paidDrafts, paidRecoveryIdeaIds: recoveryIds, paidRecoveryPolicy: job.policy,
        [ORIGINAL_PAID_RECOVERY_KEY]: { ...recovery, excludedIdeaIds: [...excluded] } } }));
    }
    const result = await runOriginalProduction<Subject, DraftEvaluation>({ session, deps: {
      loadSubjects: async () => {
        const built = buildGenerationBriefsV2({ count: 1, requestedTopic: input.requestedTopic, stories, documents,
          voiceProfile: input.voiceProfile, analysis: input.analysis, learnings: input.learnings, style: input.style,
          trending: input.trending, allTweets: input.allTweets, signals: input.signals, blocks, recentIdeas,
          seedRotationKey: runId, dynamicIdeaSeeds, durable: true });
        const qualified = built.filter(b => b.evidenceMode === 'operator_opinion'
          ? b.sourceLane === 'manual_core_exploit' && b.identityScore >= .68
          : b.sourceDocumentIds.length > 0 && b.qualifiedClaimIds.length > 0);
        const subjects = await prepareSubjects(prioritizeCurrentInterestBriefsV2(qualified, runId, true).slice(0, 2));
        // Existing receipt/status readers address this stable artifact name.
        await session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, briefs: subjects } }));
        return subjects;
      },
      validateSubjects: validate,
      ideate: async subjects => {
        const prompt = buildOriginalIdeationPrompt(subjects.map(s => ({ briefId: s.id, context: s.editorialContext })));
        const response = await call('idea_generation', { ...prompt, modelStack: input.modelStack, timeoutMs: 120_000, maxTokens: 2200, temperature: .8 });
        const raw = parseArray(response.text, 'ideas');
        if (!Array.isArray(raw) || raw.length !== subjects.length * 3
          || subjects.some(s => raw.filter(i => i.briefId === s.id && s.subjectPacket!.permittedModes.includes(i.contentMode) && Array.isArray(i.evidenceIds) && i.evidenceIds.every(id => s.sourceDocumentIds.includes(id))).length !== 3)) throw new Error('malformed_output');
        const normalized = normalizeIdeaCandidatesV2({ raw, agentId: input.agentId, runId, briefs: subjects,
          voiceProfile: input.voiceProfile, recentPosts: input.recentPosts, blocks, documents, simpleContract: true,
          surface: 'original', now: new Date(session.job.createdAt).toISOString() });
        return normalized.map(idea => {
          const original = raw.find(row => row.briefId === idea.briefId && row.publicMove === idea.publicMove);
          return { ...idea, supportingReasoning: original?.supportingReasoning || '', generatorRankScore: Number.isFinite(original?.rankScore) ? original.rankScore : 0 };
        }).sort((a, b) => b.generatorRankScore - a.generatorRankScore || b.identityScore - a.identityScore);
      },
      write: async (idea, subjects) => {
        const source = subjects.find(s => s.id === idea.briefId)!;
        const prompt = buildOriginalWritingPrompt({ idea: { ...idea, contentMode: idea.contentMode || source.editorialContext.contentMode, publicMove: idea.publicMove || idea.claim }, context: contextForOriginalMode(source.editorialContext, idea.contentMode || source.editorialContext.contentMode) });
        const response = await call('tweet_writing', { ...prompt, modelStack: input.modelStack, timeoutMs: 120_000, maxTokens: 2400, temperature: .8 });
        const raw = parseArray(response.text, 'drafts');
        if (!Array.isArray(raw) || raw.length !== 3 || raw.some(draft => draft.ideaId !== idea.id || typeof draft.content !== 'string' || draft.content.trim().length < 12)) throw new Error('malformed_output');
        return raw.map((entry, index) => {
          const content = normalizeDraftContentV2(entry.content);
          const now = new Date(session.job.createdAt).toISOString();
          const draft: DraftCandidate = { schemaVersion: 2, id: stableResearchId('draft', runId, idea.id, index, content),
            agentId: input.agentId, generationRunId: runId, surface: 'original', ideaId: idea.id, storyClusterId: idea.storyClusterId,
            content, format: entry.format || 'short', posture: entry.posture || `Variant ${index + 1}`,
            voiceAnchorIds: source.editorialContext.exampleRefs.map(e => e.id), evidenceIds: idea.evidenceIds,
            generationModelStack: input.modelStack, generationProvider: response.provider, generationModel: response.model,
            judgeProvider: null, judgeModel: null, judgeScore: null, mutationRound: 0, status: 'generated', rejectionCodes: [], createdAt: now, updatedAt: now };
          return preflight(draft, idea, source);
        });
      },
      assess: async (evaluations, idea, subjects) => {
        const subject = subjects.find(row => row.id === idea.briefId)!;
        const originalEditorialContext = contextForOriginalMode(subject.editorialContext, idea.contentMode || subject.editorialContext.contentMode);
        const selected = await qualifyOriginalDrafts({ evaluations, input: { ...assessmentInput, originalEditorialContext }, calls: [], blocks });
        if (evaluations.some(e => e.draft.rejectionCodes.includes('malformed_copy_judgment'))) throw new Error('malformed_output');
        if (evaluations.some(e => e.draft.rejectionCodes.includes('copy_judge_unavailable'))) throw new Error('copy_judgment_failed');
        return selected;
      },
      persistIdeas: async values => { ideas = values.map(normalizeCandidateDisposition); await upsertIdeaCandidates(input.agentId, ideas); await record(); },
      persistDrafts: async values => { drafts = values.map(normalizeCandidateDisposition); await upsertDraftCandidates(input.agentId, drafts); await record(); },
    } });
    const selectedIdeaId = (session.job.checkpoints.selectedIdeas as string[] || [])[0];
    const selectedIdea = result.ideas.find(idea => idea.id === selectedIdeaId);
    if (selectedIdea) await validate(result.subjects, selectedIdea);
    trace.sourceDocumentIds = [...new Set(result.subjects.flatMap(s => s.sourceDocumentIds))];
    trace.storyClusterIds = result.subjects.flatMap(s => s.storyClusterId ? [s.storyClusterId] : []);
    trace.inputFingerprint = jobFingerprint(result.subjects);
    trace.stageCounts.briefs = result.subjects.length;
    trace.selectedDraftIds = result.selected.flatMap(c => c.draftCandidateId ? [c.draftCandidateId] : []);
    trace.status = result.selected.length ? 'completed' : 'empty'; trace.outcomeCode = result.outcome;
    await record(); return result.selected;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'provider_failure';
    trace.status = 'failed'; trace.error = reason;
    trace.outcomeCode = ['payment_required', 'voice_not_ready', 'budget_exhausted', 'budget_unavailable', 'run_deadline', 'malformed_output', 'copy_judgment_failed'].includes(reason)
      ? reason as GenerationRunTrace['outcomeCode'] : 'provider_failure';
    await record(); throw error;
  } finally {
    await releaseAiCompletionHold(input.agentId, runId).catch(() => null);
  }
}
