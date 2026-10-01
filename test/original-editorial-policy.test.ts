import { describe, expect, it, vi } from 'vitest';
import { preflightDraft, qualifyContinuousOriginalDrafts, type GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import { ORIGINAL_EDITORIAL_POLICY_VERSION, ORIGINAL_EDITORIAL_QUALITY_THRESHOLD, isCurrentOriginalEditorialDecision, originalEditorialPreflightBlockers } from '@/lib/original-editorial-policy';
import { EDITORIAL_DIMENSIONS, EDITORIAL_HARD_BLOCKERS, type EditorialAssessment } from '@/lib/editorial-contract';
import { buildSubjectPacket } from '@/lib/subject-packet';
import { buildOriginalEditorialContext } from '@/lib/original-editorial-context';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';

vi.mock('@/lib/account-taste', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/account-taste')>(),
  assessAccountTaste: () => ({ nativeVoiceScore: .1, casualStartupScore: .1, stiffnessRisk: .9,
    cringeRisk: .9, truthfulnessRisk: 0, technicalCredibilityScore: .1, voiceDriftRisk: .9,
    statusTextureRisk: 0, generatedPatternRisk: .9, sourceCopyRisk: 0 }),
}));

function fixture(scores = [.78, .85, .8]) {
  const voiceProfile = { accountHandle: 'geoffwoo', tone: 'casual', topics: ['health'], antiGoals: [],
    communicationStyle: 'short ordinary words', summary: 'A founder who cares about health.' } as any;
  const brief: any = { id: 'subject', topic: 'health', title: 'A quiet dinner', summary: 'A personal preference.',
    authorOpportunity: 'A plain opinion.', sourceLane: 'manual_core_exploit', evidenceMode: 'operator_opinion',
    evidence: [], evidenceIds: [], sourceDocumentIds: [], qualifiedClaimIds: [], storyClusterId: null,
    trendTopicId: null, trendHeadline: null, sourceBrief: 'Opinion, no factual premise.', identityScore: .9,
    evidenceScore: 1, freshnessScore: 1 };
  brief.subjectPacket = buildSubjectPacket(brief, []);
  const context = buildOriginalEditorialContext({ voiceProfile, subject: brief.subjectPacket, contentMode: 'opinion', voiceExamples: [] });
  const idea: any = { id: 'idea', briefId: brief.id, topic: 'health', publicMove: 'i would take the quiet dinner.',
    claim: 'i would take the quiet dinner.', evidenceIds: [], noveltyScore: .8, identityScore: .9,
    evidenceScore: 1, contentMode: 'opinion' };
  const evaluations: any[] = ['a quiet dinner sounds good to me.', 'i would take the quiet dinner.', 'the dinner without a guest list, please.']
    .map((content, index) => ({ idea, brief, sourceDocuments: [], anchors: [], draft: {
      id: `draft-${index}`, agentId: '13', generationRunId: 'test-generation', ideaId: idea.id, content,
      format: 'short_punch', status: 'generated', rejectionCodes: [], generationModel: 'gpt-6-astra', generationProvider: 'openai',
    } }));
  const assessments: EditorialAssessment[] = scores.map(editorialScore => ({ editorialScore, explanation: 'Worthwhile in the author voice.',
    hardBlockers: [], diagnostics: ['Low originality is a diagnostic.'],
    dimensions: Object.fromEntries(EDITORIAL_DIMENSIONS.map(dimension => [dimension, { score: dimension === 'originality' ? .1 : .8,
      explanation: 'Dimension diagnosis.' }])) as EditorialAssessment['dimensions'] }));
  const call = vi.fn(async (_stage, options) => ({ text: JSON.stringify({ assessments:
    JSON.parse(options.prompt).candidates.map((candidate: any) => ({ id: candidate.id, assessment: assessments[Number(candidate.id.split('-')[1])] })) }),
    provider: 'openai', model: 'gpt-6-astra', stopReason: 'stop' }));
  const input: GenerateTweetBatchV2Input = { agentId: '13', count: 1, durableGeneration: true, mode: 'live',
    modelStack: 'publishing_v2_astra', originalEditorialPolicy: ORIGINAL_EDITORIAL_POLICY_VERSION,
    originalEditorialContext: context, originalModelCall: call as any, voiceProfile,
    allTweets: [], recentPosts: [], signals: [], memory: null, trending: [], analysis: {} as any,
    learnings: { voiceCorpus: { active: true, snapshotId: 'voice-current' } } as any,
    style: { autonomyMode: 'balanced', trendMixTarget: 25, banditPolicy: null } as any };
  return { input, evaluations, assessments, call };
}

describe('continuous original editorial decision', () => {
  it('judges once, chooses the best passing sibling, and preserves diagnostics without old scores', async () => {
    const { input, evaluations, call } = fixture();
    const selected = await qualifyContinuousOriginalDrafts({ input, evaluations, calls: [] });
    expect(call).toHaveBeenCalledTimes(1);
    expect(selected).toHaveLength(1);
    expect(selected[0].draftCandidateId).toBe('draft-1');
    expect(evaluations.map(row => row.draft.status)).toEqual(['reserve', 'selected', 'reserve']);
    expect(selected[0].finalCriticScores).toBeNull();
    expect(selected[0].judgeBreakdown).toBeNull();
    expect(selected[0].assessmentReceipt?.editorialDecision?.assessment.dimensions.originality.score).toBe(.1);
    expect(isCurrentOriginalEditorialDecision(evaluations[1].draft.editorialDecision)).toBe(true);
    expect(getGeneratedPublishIssue(selected[0], { agentId: '13', accountHandle: 'geoffwoo' })).toBeNull();
    expect(call.mock.calls[0][1].system).toContain('Do not demand a forecast');
    expect(call.mock.calls[0][1].system).not.toContain('frontierLead');
  });

  it.each(EDITORIAL_HARD_BLOCKERS)('rejects %s even at a perfect editorial score', async blocker => {
    const { input, evaluations, assessments } = fixture([1, 1, 1]);
    assessments.forEach(assessment => { assessment.hardBlockers = [blocker]; });
    expect(await qualifyContinuousOriginalDrafts({ input, evaluations, calls: [] })).toEqual([]);
    expect(evaluations.every(row => row.draft.rejectionCodes.includes(`editorial_${blocker}`))).toBe(true);
  });

  it('accepts the exact provisional threshold and rejects its lower neighbor', async () => {
    const { input, evaluations } = fixture([.749, ORIGINAL_EDITORIAL_QUALITY_THRESHOLD, .1]);
    const selected = await qualifyContinuousOriginalDrafts({ input, evaluations, calls: [] });
    expect(selected[0].draftCandidateId).toBe('draft-1');
    expect(evaluations[0].draft.rejectionCodes).toEqual(['editorial_below_threshold']);
  });

  it('retains malformed and unavailable judgment as unfinished paid work', async () => {
    const { input, evaluations, call } = fixture();
    call.mockResolvedValueOnce({ text: '{"assessments":[]}', provider: 'openai', model: 'gpt-6-astra', stopReason: 'stop' });
    await expect(qualifyContinuousOriginalDrafts({ input, evaluations, calls: [] })).rejects.toThrow('malformed_output');
    expect(evaluations.every(row => row.draft.status === 'pending_assessment')).toBe(true);
    const next = fixture(); next.call.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(qualifyContinuousOriginalDrafts({ input: next.input, evaluations: next.evaluations, calls: [] })).rejects.toThrow('provider_pending');
    expect(next.evaluations.every(row => row.draft.status === 'generated')).toBe(true);
  });

  it('moves style floors to diagnostics only for the authorized account policy', () => {
    const { input, evaluations } = fixture();
    const run = (agentId: string) => {
      const entry = structuredClone(evaluations[0]);
      return preflightDraft({ ...entry, documents: [], input: { ...input, agentId }, blocks: [] }).draft;
    };
    expect(run('13').status).toBe('generated');
    expect(run('13').diagnosticCodes).toContain('final_native_voice_below_floor');
    expect(run('other-account').status).toBe('rejected');
  });

  it('keeps duplicate and unsupported factual preflight blockers', () => {
    const { input, evaluations } = fixture();
    const duplicate = structuredClone(evaluations[0]);
    const result = preflightDraft({ ...duplicate, documents: [], input: { ...input, recentPosts: [duplicate.draft.content] }, blocks: [] });
    expect(result.draft.rejectionCodes).toContain('recent_copy_duplicate');
    const invented = structuredClone(evaluations[0]); invented.draft.content = 'I met the founder yesterday and saw their contracts.';
    expect(preflightDraft({ ...invented, documents: [], input, blocks: [] }).draft.rejectionCodes).toContain('unsupported_operator_fact');
  });

  it('distinguishes broad wording from fabricated experience and explicit owner restrictions', () => {
    expect(originalEditorialPreflightBlockers(['unearned_authority'])).toEqual([]);
    expect(originalEditorialPreflightBlockers(['blocked_copy_pattern'])).toEqual(['owner_restriction']);
    expect(originalEditorialPreflightBlockers(['operator_stripped_event_reintroduced'])).toEqual(['unsupported_fact']);
    const { input, evaluations } = fixture();
    const entry = structuredClone(evaluations[0]); entry.draft.content = 'everyone should leave a little room for a quiet dinner.';
    const passed = preflightDraft({ ...entry, documents: [], input, blocks: [] }).draft;
    expect(passed.status).toBe('generated');
    expect(passed.diagnosticCodes).toContain('unearned_authority');
    const blocked = preflightDraft({ ...structuredClone(evaluations[0]), documents: [], input,
      blocks: [{ scope: 'copy', semanticKey: evaluations[0].draft.content }] as any }).draft;
    expect(blocked.rejectionCodes).toContain('blocked_copy_pattern');
  });
});
