import { describe, expect, it, vi } from 'vitest';
import { normalizeIdeaCandidatesV2, preflightDraft, qualifyContinuousOriginalDrafts, originalReturnComparisonTexts, type GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import { ORIGINAL_EDITORIAL_POLICY_VERSION, ORIGINAL_EDITORIAL_QUALITY_THRESHOLD, isCurrentOriginalEditorialDecision, originalEditorialPreflightBlockers } from '@/lib/original-editorial-policy';
import { EDITORIAL_DIMENSIONS, EDITORIAL_HARD_BLOCKERS, type EditorialAssessment } from '@/lib/editorial-contract';
import { buildSubjectPacket } from '@/lib/subject-packet';
import { buildOriginalEditorialContext } from '@/lib/original-editorial-context';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { assessOriginalRepetition, buildOriginalRepetitionContext } from '@/lib/original-repetition';
import { isNearDuplicate } from '@/lib/survivability';
import type { Tweet, TweetPerformance } from '@/lib/types';

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
  it('defers only server-eligible return comparisons to the semantic editor, preserving exact and queued duplicates', () => {
    const original = 'i want founders building by choice rather than selling because they need liquidity.';
    const context = { comparators: [{ content: original, status: 'posted', reuseEligible: true }] } as any;
    expect(originalReturnComparisonTexts('a new expression of the same choice', [original, 'unmatched'], context)).toEqual(['unmatched']);
    expect(originalReturnComparisonTexts(original.toUpperCase(), [original], context)).toEqual([original]);
    expect(originalReturnComparisonTexts('new wording', [original], context, [{ content: original, status: 'queued' }])).toEqual([original]);
    expect(originalReturnComparisonTexts('new wording', [original], { comparators: [{ content: original, status: 'posted', reuseEligible: false }] } as any)).toEqual([original]);
  });

  it('lets a second fully spaced return reach the editor without requiring its previous return to go viral', () => {
    const day = 24 * 60 * 60 * 1000, firstNow = Date.parse('2026-10-01T00:00:00Z');
    const historical = (id: string, age: number, content: string) => ({ id, agentId: '13', type: 'original',
      status: 'posted', content, xTweetId: `x-${id}`, topic: 'AI', postedAt: new Date(firstNow - age * day).toISOString(),
      createdAt: new Date(firstNow - age * day).toISOString() }) as Tweet;
    const winner = historical('winner', 30, 'paying for AI should buy judgment. challenge the assignment before doing it.');
    const earlier = Array.from({ length: 25 }, (_, i) => historical(`earlier-${i}`, 25 - i / 2, `Independent earlier observation ${i}.`));
    const performance: TweetPerformance[] = [winner, ...earlier.slice(0, 8)].map(post => ({
      tweetId: post.id, xTweetId: post.xTweetId!, content: post.content, topic: 'AI', format: 'observation',
      postedAt: post.postedAt!, checkedAt: new Date(Date.parse(post.postedAt!) + day).toISOString(),
      likes: post.id === 'winner' ? 120 : 10, retweets: 2, replies: 1, impressions: 1000,
      engagementRate: 1.3, source: 'autopilot', wasViral: post.id === 'winner',
    }));
    const originalContext = buildOriginalRepetitionContext({ tweets: [winner, ...earlier], performance, query: winner.content, now: firstNow });
    const priorReturn = historical('prior-return', 0, `${winner.content} even when agreement is easier.`);
    const { proof, issue } = assessOriginalRepetition({ context: originalContext, content: priorReturn.content,
      assessment: { verdict: 'repeat', matchedTweetIds: ['winner'], explanation: 'Return to the measured winner.' } });
    expect(issue).toBeNull();
    priorReturn.assessmentReceipt = { editorialDecision: { repetition: proof! } } as any;
    const intervening = Array.from({ length: 21 }, (_, i) => historical(`later-${i}`, -(i + 1) / 2, `Independent later observation ${i}.`));
    const history = [priorReturn, winner, ...earlier, ...intervening];
    const now = firstNow + 15 * day;
    const context = buildOriginalRepetitionContext({ tweets: history, performance, query: winner.content, now });
    expect(context.comparators.find(row => row.tweetId === 'winner')?.reuseEligible).toBe(true);
    expect(context.comparators.find(row => row.tweetId === priorReturn.id)).toMatchObject({ reuseEligible: false,
      eligibilityReasons: ['mature_viral_evidence_unavailable'] });
    const candidate = `${priorReturn.content} i want an honest answer.`;
    const texts = [winner.content, priorReturn.content];
    expect(isNearDuplicate(candidate, texts, .55).isDuplicate).toBe(true);
    expect(originalReturnComparisonTexts(candidate, texts, context, history)).toEqual([]);
    expect(originalReturnComparisonTexts(priorReturn.content, texts, context, history)).toEqual([priorReturn.content]);
    expect(originalReturnComparisonTexts(candidate, texts, context, [...history, { ...priorReturn, status: 'queued' }])).toEqual([priorReturn.content]);

    const unlinked = structuredClone(context);
    unlinked.comparators.find(row => row.tweetId === priorReturn.id)!.tweetId = 'unlinked';
    expect(originalReturnComparisonTexts(candidate, texts, unlinked, history)).toEqual([priorReturn.content]);
    const tooRecent = buildOriginalRepetitionContext({ tweets: history, performance, query: winner.content, now: firstNow + 13 * day });
    expect(originalReturnComparisonTexts(candidate, texts, tooRecent, history)).toEqual(texts);
    const deletedHistory = history.map(post => post.id === priorReturn.id ? { ...post, status: 'deleted_from_x' as const } : post);
    const deleted = buildOriginalRepetitionContext({ tweets: deletedHistory, performance, query: winner.content, now });
    expect(originalReturnComparisonTexts(candidate, texts, deleted, deletedHistory)).toEqual(texts);
  });

  it('lets a measured manual winner reach the one editor through all operator-history fuzzy gates', async () => {
    const f = fixture([.9, .9, .9]);
    const day = 24 * 60 * 60 * 1000, now = Date.now();
    const original = 'i would take the quiet dinner. no speeches, no seating chart, just a conversation that can wander.';
    const content = 'i would take the quiet dinner. no speeches or seating chart, just a conversation free to wander.';
    const historical = (id: string, age: number, text: string) => ({ id, agentId: '13', type: 'original',
      status: 'posted', content: text, xTweetId: `x-${id}`, topic: 'health',
      postedAt: new Date(now - age * day).toISOString(), createdAt: new Date(now - age * day).toISOString() }) as Tweet;
    const winner = historical('manual-winner', 30, original);
    const intervening = Array.from({ length: 25 }, (_, i) => historical(`after-winner-${i}`, 25 - i / 2, `Independent observation ${i}.`));
    const history = [winner, ...intervening];
    const performance: TweetPerformance[] = [winner, ...intervening.slice(0, 8)].map(post => ({
      tweetId: post.id, xTweetId: post.xTweetId!, content: post.content, topic: 'health', format: 'observation',
      postedAt: post.postedAt!, checkedAt: new Date(Date.parse(post.postedAt!) + day).toISOString(),
      likes: post.id === winner.id ? 120 : 10, retweets: 2, replies: 1, impressions: 1000,
      engagementRate: 1.3, source: 'manual', authorshipProvenance: 'operator_composed', wasViral: post.id === winner.id,
    }));
    const context = buildOriginalRepetitionContext({ tweets: history, performance, query: content, now });
    expect(context.comparators.find(row => row.tweetId === winner.id)?.reuseEligible).toBe(true);
    expect(isNearDuplicate(content, [original], .68).isDuplicate).toBe(true);
    f.input.allTweets = history; f.input.recentPosts = [original]; f.input.originalRepetitionContext = context;
    f.input.learnings!.operatorVoiceReference = { bestPerformers: [performance[0]] } as any;
    const brief = f.evaluations[0].brief;
    brief.personalTopicSignalPremises = [original];
    brief.editorialContext = { ...f.input.originalEditorialContext!, repetitionHistory: context };
    const normalize = (publicMove: string, repetitionHistory = context, recentPosts = [original]) => normalizeIdeaCandidatesV2({
      raw: [{ briefId: brief.id, publicMove, contentMode: 'opinion', evidenceIds: [], factualRisk: 'low' }],
      agentId: '13', runId: 'manual-return', briefs: [{ ...brief, editorialContext: { ...brief.editorialContext, repetitionHistory } }] as any,
      voiceProfile: f.input.voiceProfile, recentPosts, blocks: [], simpleContract: true, now: new Date(now).toISOString(),
    })[0];
    const idea = normalize(content);
    expect(idea.status).toBe('generated');
    expect(normalize(original).rejectionCodes).toContain('recent_semantic_repeat');
    expect(normalize(content, { ...context, comparators: [] }, []).rejectionCodes).toContain('voice_anchor_semantic_reskin');
    const preflight = (text: string, options: { comparison?: boolean; anchor?: boolean; operator?: boolean; personal?: boolean } = {}) => {
      const entry = structuredClone(f.evaluations[0]);
      entry.idea = { ...idea, id: f.evaluations[0].idea.id };
      entry.draft.content = text;
      entry.anchors = options.anchor === false ? [] : [{ id: 'manual-anchor', content: original, topic: 'health' }];
      entry.brief.personalTopicSignalPremises = options.personal === false ? [] : [original];
      if (options.comparison === false) delete entry.brief.editorialContext.repetitionHistory;
      return preflightDraft({ ...entry, documents: [], blocks: [], input: { ...f.input,
        recentPosts: [], allTweets: [], learnings: options.operator === false ? null : f.input.learnings } });
    };
    // Each legacy history source actually blocks this take without its narrow
    // eligible comparison, so passing cannot hide an untested parallel gate.
    expect(preflight(content, { comparison: false, operator: false, personal: false }).draft.rejectionCodes).toContain('voice_anchor_reskin');
    expect(preflight(content, { comparison: false, anchor: false, personal: false }).draft.rejectionCodes).toContain('voice_anchor_semantic_reskin');
    expect(preflight(content, { comparison: false, anchor: false, operator: false }).draft.rejectionCodes).toContain('voice_anchor_semantic_reskin');
    const passed = preflight(content);
    expect(passed.draft.status).toBe('generated');
    expect(preflight(original).draft.rejectionCodes).toContain('voice_anchor_reskin');
    const bestPerformers = f.input.learnings!.operatorVoiceReference!.bestPerformers;
    f.input.learnings!.operatorVoiceReference!.bestPerformers = [...bestPerformers,
      { ...performance[0], tweetId: 'unmatched-operator', content: `${original} please.` }];
    expect(preflight(content, { anchor: false, personal: false }).draft.rejectionCodes).toContain('voice_anchor_semantic_reskin');
    f.input.learnings!.operatorVoiceReference!.bestPerformers = bestPerformers;
    f.call.mockImplementation(async (_stage, options) => ({ text: JSON.stringify({ assessments:
      JSON.parse(options.prompt).candidates.map((candidate: any) => ({ id: candidate.id, assessment: f.assessments[0],
        repetition: { verdict: 'repeat', matchedTweetIds: [winner.id], explanation: 'A measured winner after the required gap.' } })) }),
      provider: 'openai', model: 'gpt-6-astra', stopReason: 'stop' }));
    expect(await qualifyContinuousOriginalDrafts({ input: f.input, evaluations: [passed], calls: [] })).toHaveLength(1);
    expect(f.call).toHaveBeenCalledTimes(1);
  });
  function repetitionFixture(verdict: 'fresh' | 'repeat' | 'uncertain', matchedTweetIds: string[]) {
    const f = fixture([.95, .95, .95]);
    const now = Date.parse('2026-10-22T03:00:00Z');
    f.input.originalRepetitionContext = buildOriginalRepetitionContext({
      tweets: [{ id: '12583', agentId: '13', type: 'original', status: 'posted',
        xTweetId: '2110543871411183999', postedAt: '2026-10-15T01:30:45Z', createdAt: '2026-10-15T01:00:00Z',
        content: "vcs: i'm fine with a founder taking enough secondary to get rent off their mind. i don't need financial anxiety as proof they're all in." } as any],
      performance: [], query: 'founder secondary mortgage financial anxiety', now,
    });
    f.call.mockImplementation(async (_stage, options) => ({ text: JSON.stringify({ assessments:
      JSON.parse(options.prompt).candidates.map((candidate: any) => ({ id: candidate.id,
        assessment: f.assessments[Number(candidate.id.split('-')[1])],
        repetition: { verdict, matchedTweetIds, explanation: 'Explicit same-take comparison.' } })) }),
      provider: 'openai', model: 'gpt-6-astra', stopReason: 'stop' }));
    return f;
  }

  it('uses the same final call to reject a paraphrased nonviral take despite a high score', async () => {
    const f = repetitionFixture('repeat', ['12583']);
    f.evaluations.forEach(row => { row.draft.content = "i'm fine with a founder selling enough shares to pay off their mortgage. financial anxiety isn't a requirement."; });
    expect(await qualifyContinuousOriginalDrafts({ input: f.input, evaluations: f.evaluations, calls: [] })).toEqual([]);
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.evaluations.every(row => row.draft.rejectionCodes.includes('editorial_substantive_duplicate'))).toBe(true);
    expect(JSON.parse(f.call.mock.calls[0][1].prompt).repetitionContext.comparators[0].tweetId).toBe('12583');
    expect(f.call.mock.calls[0][1].system).toContain('Shared topics alone are not the same take');
  });

  it('keeps a genuinely fresh thought eligible and binds its comparison proof to the receipt', async () => {
    const f = repetitionFixture('fresh', []);
    const selected = await qualifyContinuousOriginalDrafts({ input: f.input, evaluations: f.evaluations, calls: [] });
    expect(selected).toHaveLength(1);
    const proof = selected[0].assessmentReceipt?.editorialDecision?.repetition;
    expect(proof?.assessment.verdict).toBe('fresh');
    expect(proof?.contentHash).toBe(selected[0].assessmentReceipt?.contentHash);
    expect(getGeneratedPublishIssue(selected[0], { agentId: '13', accountHandle: 'geoffwoo' })).toBeNull();
    expect(f.call).toHaveBeenCalledTimes(1);
  });

  it.each([['uncertain', []], ['repeat', ['invented-post']]] as const)('cannot approve %s repetition evidence', async (verdict, ids) => {
    const f = repetitionFixture(verdict, [...ids]);
    expect(await qualifyContinuousOriginalDrafts({ input: f.input, evaluations: f.evaluations, calls: [] })).toEqual([]);
    expect(f.call).toHaveBeenCalledTimes(1);
  });

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
