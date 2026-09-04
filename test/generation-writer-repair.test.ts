import { describe, expect, it } from 'vitest';
import {
  buildIdeaGenerationPromptV2, buildTweetWritingPromptV2,
  derivedVoiceProfileGuidanceV2, derivedWritingConstraintsV2,
  isV2CriticExecutionRepairEligible, V2_INDEPENDENT_WRITER_SHAPE_INSTRUCTION,
} from '@/lib/generation-v2';
import { founderBrief, founderDraft, founderIdea } from './fixtures/founder-critic-execution';

const voice = {
  tone: 'casual and direct', topics: ['founder ownership'], summary: 'A founder and investor.',
  communicationStyle: 'Uneven thoughts and direct judgments.',
  antiGoals: ['Do not sound like:\n- sell-side analyst\n- generic founder coach\n\n## 4) Content Pillars\n### A) Venture Delusion / Capital Allocation\nExpose consensus masquerading as judgment.\nHigh-performing angle:\n- Tell a story from a trip, call, demo, dinner, or round'],
};
const constraints = { targetQuestionPercent: 15, recentWindowSize: 12, recentQuestionCount: 3,
  maxQuestionDraftsInBatch: 0, preferredFormats: ['story'],
  doMore: ['Write more story-format posts: stories average 447; use a clear setup→tension→payoff arc instead of a single-point claim.', 'Keep an owned position.'],
  avoid: ['invented personal experience'] };

describe('writer preserves approved substance and derived voice meaning', () => {
  it('separates positive SOUL sections from anti-goals without rewriting the profile', () => {
    const original = structuredClone(voice);
    const guidance = derivedVoiceProfileGuidanceV2(voice);
    expect(guidance.antiGoals).toEqual(['Do not sound like:\n- sell-side analyst\n- generic founder coach']);
    expect(guidance.soulThemes.join('\n')).toContain('Content Pillars');
    expect(guidance.soulThemes.join('\n')).toContain('Tell a story');
    expect(voice).toEqual(original);
    const ideaPrompt = JSON.parse(buildIdeaGenerationPromptV2([founderBrief], voice));
    expect(ideaPrompt.author.antiGoals).toEqual(guidance.antiGoals);
    expect(ideaPrompt.author.soulThemes).toEqual(guidance.soulThemes);
    expect(derivedVoiceProfileGuidanceV2({ antiGoals: [...voice.antiGoals, '## Hard boundaries\nNever invent a meeting.'] }).antiGoals).toContain('## Hard boundaries\nNever invent a meeting.');
  });

  it.each(['direct_judgment', 'concrete_decision', 'unexpected_consequence'] as const)('preserves the approved semantic packet for %s without forcing its anchor into a one-liner', (move) => {
    const payload = JSON.parse(buildTweetWritingPromptV2(founderIdea, founderBrief, [], [
      { id: 'rough-multibeat', content: 'a rough first beat\n\na second thought with stakes', topic: 'founder ownership' },
    ], undefined, constraints, undefined, 'reconceive', 1, null, false, voice, [], move));
    expect(payload.idea.publicMove).toBe(founderIdea.publicMove);
    expect(payload.idea.stakes).toBe(founderIdea.implication);
    expect(payload.factualWritingContract).toContain('concrete fact ceiling');
    expect(payload.author.antiGoals.join('\n')).not.toContain('Content Pillars');
    expect(payload.author.soulThemes.join('\n')).toContain('Content Pillars');
    expect(payload.writingConstraints.doMore).toEqual(['Keep an owned position.']);
    expect(payload.writingConstraints.formatInstruction).toContain('requires an event supplied');
    expect(payload.responseContract.independentCreativeMove.instruction).not.toContain('Stop before explaining');
    if (move === 'direct_judgment') expect(payload.responseContract.independentCreativeMove.instruction).toContain('specific stake');
    if (move === 'unexpected_consequence') expect(payload.responseContract.independentCreativeMove.instruction).toContain('publicMove, pressure, or stakes');
    expect(V2_INDEPENDENT_WRITER_SHAPE_INSTRUCTION).toContain('uneven beats');
    expect(V2_INDEPENDENT_WRITER_SHAPE_INSTRUCTION).not.toContain('shortest');
  });

  it('keeps raw SOUL examples out of ideation, including nested example sections', () => {
    const profile = { ...voice, antiGoals: [`${voice.antiGoals[0]}\n### Examples\nA prior tweet with its own recognizable premise.\n#### Second example\nAnother old premise.\n### New interests\nBiotech production.`] };
    const ideation = JSON.parse(buildIdeaGenerationPromptV2([founderBrief], profile));
    expect(JSON.stringify(ideation.author)).not.toContain('recognizable premise');
    expect(JSON.stringify(ideation.author)).not.toContain('Another old premise');
    expect(JSON.stringify(ideation.author)).toContain('Biotech production');
    const writer = JSON.parse(buildTweetWritingPromptV2(founderIdea, founderBrief, [], [], undefined, undefined, undefined, 'reconceive', 1, null, false, profile));
    expect(JSON.stringify(writer.author.soulThemes)).toContain('recognizable premise');
  });

  it('treats learned story format as an optional prior while keeping question limits and raw lessons intact', () => {
    const original = structuredClone(constraints);
    const derived = derivedWritingConstraintsV2(constraints);
    expect(derived).toMatchObject({ maxQuestionDraftsInBatch: 0, preferredFormats: ['story'], avoid: constraints.avoid });
    expect(derived?.doMore).toEqual(['Keep an owned position.']);
    expect(constraints).toEqual(original);
  });
});

describe('one critic-directed execution repair admission', () => {
  const eligible = () => ({ modelStack: 'publishing_v2_astra' as const, idea: structuredClone(founderIdea), draft: structuredClone(founderDraft) });
  it('admits the fact-safe founder failure even though it was below the old near-miss margin', () => {
    expect(founderDraft.judgeBreakdown?.qualityMargin).toBeLessThan(0.77);
    expect(isV2CriticExecutionRepairEligible(eligible())).toBe(true);
    expect(founderDraft.status).toBe('rejected');
  });
  it.each(['publishing_v2_gpt_control', 'publishing_v2_quality', 'publishing_v2_fable_control'] as const)('does not change %s admission', (modelStack) => {
    expect(isV2CriticExecutionRepairEligible({ ...eligible(), modelStack })).toBe(false);
  });
  it.each(['copy_judge_factual_risk', 'unsupported_operator_fact', 'generated_writing_pattern', 'copy_judge_anchor_reskin', 'copy_judge_unavailable', 'final_cringe_risk'])('never repairs through %s', (code) => {
    const candidate = eligible(); candidate.draft.rejectionCodes.push(code);
    expect(isV2CriticExecutionRepairEligible(candidate)).toBe(false);
  });
  it('requires a strong selected idea, actual critic diagnosis, factual confidence, and an original draft', () => {
    for (const mutate of [
      (value: ReturnType<typeof eligible>) => { value.idea.judgeScore = 0.79; },
      (value: ReturnType<typeof eligible>) => { value.idea.status = 'rejected'; },
      (value: ReturnType<typeof eligible>) => { value.draft.judgeRawNotes = ''; },
      (value: ReturnType<typeof eligible>) => { value.draft.judgeRawNotes = 'The post is already fully formed.'; },
      (value: ReturnType<typeof eligible>) => { value.draft.judgeBreakdown!.policySafety = 0.81; },
      (value: ReturnType<typeof eligible>) => { value.draft.mutationRound = 1; },
      (value: ReturnType<typeof eligible>) => { value.draft.parentDraftId = 'earlier'; },
    ]) { const value = eligible(); mutate(value); expect(isV2CriticExecutionRepairEligible(value)).toBe(false); }
  });
});
