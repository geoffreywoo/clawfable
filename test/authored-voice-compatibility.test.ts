import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildOriginalEditorialContext, type OriginalEditorialContext } from '@/lib/original-editorial-context';
import { buildOriginalIdeationPrompt, buildOriginalWritingPrompt, originalModelContext } from '@/lib/original-prompts';
import { editorialAssessmentRequest } from '@/lib/editorial-contract';
import { originalAssessmentContext, qualifyContinuousOriginalDrafts } from '@/lib/generation-v2';
import { ORIGINAL_EDITORIAL_POLICY_VERSION } from '@/lib/original-editorial-policy';
import { AUTHORED_VOICE_POLICY_VERSION, authoredVoiceInstruction } from '@/lib/authored-voice-policy';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function legacyFixture() {
  const context = buildOriginalEditorialContext({
    voiceProfile: { accountHandle: 'anotherowner', summary: 'An operator.', tone: 'direct', communicationStyle: 'casual', topics: ['AI'], antiGoals: ['Do not disclose private customers.'] },
    subject: { version: 'subject-packet-1', subject: 'Agent deployment', sourceIds: ['source-a'], supportedFacts: ['Acme says its agent passed its internal test.'],
      unverifiedContext: '', permittedModes: ['observation'], observedAt: '2026-09-28T00:00:00Z', expiresAt: '2026-09-29T00:00:00Z', interest: { kind: 'research', relevance: .9 } },
    contentMode: 'observation', voiceExamples: [{ id: 'owner-1', content: 'the test takes a whole afternoon. let the customer try it.', provenance: 'operator_composed', dispositions: ['diction_anchor'] }],
  });
  delete context.authoredVoicePolicy;
  const idea = { id: 'idea-1', briefId: 'brief-1', publicMove: 'Acme says the agent passed its own test. I want an outside test.', contentMode: 'observation' as const, evidenceIds: ['source-a'], supportingReasoning: null };
  const evaluation = { idea, brief: { evidenceMode: 'verified_source' }, sourceDocuments: [],
    draft: { id: 'draft-1', content: idea.publicMove, status: 'generated', rejectionCodes: [] } } as any;
  return { context, idea, evaluation };
}

describe('authored voice legacy request compatibility', () => {
  it('pins prechange compact, ideation, writing and final-request bytes', async () => {
    const { context, idea, evaluation } = legacyFixture();
    const assessmentContext = originalAssessmentContext(context, evaluation);
    const final = editorialAssessmentRequest({ stage: 'final', context, variants: [{ id: 'draft-1', content: idea.publicMove }], model: 'gpt-6-astra', assessmentContext });
    let captured: unknown;
    await expect(qualifyContinuousOriginalDrafts({ evaluations: [evaluation], calls: [], input: {
      agentId: '13', originalEditorialPolicy: ORIGINAL_EDITORIAL_POLICY_VERSION, originalEditorialContext: context, modelStack: 'publishing_v2_astra',
      originalModelCall: async (_stage: unknown, options: unknown) => { captured = options; throw new Error('capture_only'); },
    } as any })).rejects.toThrow('capture_only');
    expect({ compact: hash(originalModelContext(context)),
      ideaOne: hash(buildOriginalIdeationPrompt([{ briefId: idea.briefId, context }])),
      ideaTwo: hash(buildOriginalIdeationPrompt([{ briefId: idea.briefId, context }, { briefId: 'brief-2', context }])),
      writing: hash(buildOriginalWritingPrompt({ idea, context })), final: hash(final), continuousCall: hash(captured) }).toEqual({
      compact: 'a7e916f8678489a6b4adb2ac14f6b3c8bd2a1dfe80542faf170b0a67f62ac89d',
      ideaOne: 'ece7527c3ccd7ca2b7ba2e3d4ba0442d46bf2cd08f4e0dc74831aa18530f7659',
      ideaTwo: '581f3b820dabf083d7b90237ae8aff1f6fc57eb49fa5d5efeaa487ac0f87e457',
      writing: '572bd5cd9a7e1618ff4211220ca6f84ef01e8e75d90ab38d26f0ffa0e00f8f88',
      final: '86091e75deeeda44a8fa938da08628469afc402c0943389355f514d893375994',
      continuousCall: '412beb8617d0573b9320d93316020bcca7f29d288dcc0ef1fba7fc2e241d3e40',
    });
  });

  it('opts in only recognized new contexts across all three stages and hashes the final system', () => {
    const { context: legacy, idea, evaluation } = legacyFixture();
    const context: OriginalEditorialContext = { ...legacy, authoredVoicePolicy: AUTHORED_VOICE_POLICY_VERSION };
    const assessmentContext = originalAssessmentContext(context, evaluation);
    const variants = [{ id: 'draft-1', content: idea.publicMove }];
    const marked = editorialAssessmentRequest({ stage: 'final', context, variants, model: 'gpt-6-astra', assessmentContext });
    const old = editorialAssessmentRequest({ stage: 'final', context: legacy, variants, model: 'gpt-6-astra', assessmentContext: originalAssessmentContext(legacy, evaluation) });
    for (const system of [buildOriginalIdeationPrompt([{ briefId: idea.briefId, context }]).system,
      buildOriginalWritingPrompt({ idea, context }).system, marked.system]) {
      expect(system).toContain('actual authored voiceExamples are the primary evidence');
      expect(system).toContain('Prefer faithful expression over generic tidiness');
      expect(system).toContain('without copying their wording, premises, facts or experience');
    }
    expect(marked.requestKey).not.toBe(old.requestKey);
    expect(marked.requestKey).toBe(hash(['original-editorial-assessment-1', marked.system, JSON.parse(marked.prompt), 'gpt-6-astra']));
    expect(JSON.parse(marked.prompt).originalEditorialContext.voiceExamples).toEqual(JSON.parse(buildOriginalWritingPrompt({ idea, context }).prompt).context.voiceExamples);
    expect(buildOriginalWritingPrompt({ idea, context }).jsonSchema).toEqual(buildOriginalWritingPrompt({ idea, context: legacy }).jsonSchema);
    expect(authoredVoiceInstruction({ authoredVoicePolicy: 'unknown-version' })).toBe('');
    const unknown = { ...legacy, authoredVoicePolicy: 'unknown-version' } as any;
    expect(originalModelContext(unknown)).toEqual(originalModelContext(legacy));
    expect(buildOriginalWritingPrompt({ idea, context: unknown })).toEqual(buildOriginalWritingPrompt({ idea, context: legacy }));
    expect(editorialAssessmentRequest({ stage: 'final', context: unknown, variants, model: 'gpt-6-astra', assessmentContext: originalAssessmentContext(unknown, evaluation) })).toEqual(old);
    const mixed = buildOriginalIdeationPrompt([{ briefId: idea.briefId, context: legacy }, { briefId: 'new', context }]);
    expect(mixed.system).toContain('For contexts marked authored-voice-primary-1');
    const payload = JSON.parse(mixed.prompt);
    expect(payload.subjects[0].context).not.toHaveProperty('authoredVoicePolicy');
    expect(payload.subjects[1].context.authoredVoicePolicy).toBe(AUTHORED_VOICE_POLICY_VERSION);
  });
});
