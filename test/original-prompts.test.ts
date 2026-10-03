import { describe, expect, it } from 'vitest';
import { buildOriginalEditorialContext, contextForOriginalMode } from '@/lib/original-editorial-context';
import { buildOriginalIdeationPrompt, buildOriginalWritingPrompt, originalModelContext, ORIGINAL_IDEATION_SCHEMA, ORIGINAL_WRITING_SCHEMA, type OriginalSelectedThought } from '@/lib/original-prompts';

const context = buildOriginalEditorialContext({
  voiceProfile: { accountHandle: 'anotherowner', summary: 'An operator.', tone: 'direct', communicationStyle: 'casual', topics: ['AI'], antiGoals: ['Do not disclose private customer information.'] },
  subject: { version: 'subject-packet-1', subject: 'Agent deployment', sourceIds: ['source-a'], supportedFacts: ['Acme says its agent passed its internal test.'], unverifiedContext: 'Unverified launch rumor.', permittedModes: ['observation', 'opinion', 'prediction'], observedAt: '2026-09-28T00:00:00Z', expiresAt: '2026-09-29T00:00:00Z', interest: { kind: 'research', relevance: .9 } },
  contentMode: 'observation', voiceExamples: [{ id: 'owner-1', content: 'A direct owner-written thought.', provenance: 'operator_composed', dispositions: ['diction_anchor'] }],
});
const idea: OriginalSelectedThought = { id: 'idea-1', briefId: 'brief-1', publicMove: 'Acme says its agent passed its own test. I want to see the outside test.', contentMode: 'observation', evidenceIds: ['source-a'], supportingReasoning: null };
function recompose(prompt: string) {
  const { sharedContext, subjects } = JSON.parse(prompt);
  return subjects.map((subject: any) => ({ briefId: subject.briefId,
    context: { ...sharedContext, ...subject.context, ownerRestrictions: [...sharedContext.ownerRestrictions, ...subject.context.ownerRestrictions] } }));
}

describe('compact original prompts', () => {
  it('factors only equal fields and common rules while preserving complete per-subject meaning', () => {
    const first = { ...context, previousPremises: ['A previous thought to avoid.'] };
    const second = { ...contextForOriginalMode(first, 'prediction'),
      subject: { ...context.subject, subject: 'Another company claim', sourceIds: ['source-b'] },
      supportedFacts: ['OtherCo says its internal benchmark rose 10%; unaudited.'],
      ownerRestrictions: [...first.ownerRestrictions, { id: 'subject:private', text: 'Never identify this customer, even if its name appears in a source.', kind: 'restriction' as const, source: 'owner_directive' as const }],
      stylePreferences: [...first.stylePreferences, { id: 'subject:tone', text: 'Prefer one careful question.', kind: 'preference' as const, source: 'owner_directive' as const }],
    };
    const original = JSON.stringify([first, second]);
    const prompt = buildOriginalIdeationPrompt([{ briefId: 'a', context: first }, { briefId: 'b', context: second }]);
    const parsed = JSON.parse(prompt.prompt);
    expect(parsed.sharedContext.author).toEqual(first.author);
    expect(parsed.sharedContext.voiceExamples).toEqual(first.voiceExamples);
    expect(parsed.subjects.every((s: any) => !s.context.author && !s.context.voiceExamples)).toBe(true);
    expect(parsed.subjects[0].context.ownerRestrictions).toEqual([]);
    expect(parsed.subjects[1].context.ownerRestrictions).toEqual([second.ownerRestrictions.at(-1)!.text]);
    expect(recompose(prompt.prompt).map((s: any) => s.context)).toEqual([originalModelContext(first), originalModelContext(second)]);
    expect(prompt.system).toContain('append subject ownerRestrictions to shared rules');
    expect(prompt.prompt).not.toMatch(/ownerGuidance|exampleRefs|excludedApplicationSections|authorshipAttestationId/);
    expect(JSON.stringify([first, second])).toBe(original);
    const writer = JSON.parse(buildOriginalWritingPrompt({ idea: { ...idea, briefId: 'b', contentMode: 'prediction', evidenceIds: ['source-b'] }, context: second }).prompt);
    expect(writer.context).toEqual(originalModelContext(second));
    expect(writer.context.supportedFacts).toEqual(second.supportedFacts);
    expect(writer.context.ownerRestrictions).toContain(second.ownerRestrictions.at(-1)!.text);
  });

  it('requests three different thoughts for each of two subjects in one call payload', () => {
    const second = { ...context, subject: { ...context.subject, subject: 'Robotics tooling' } };
    const result = buildOriginalIdeationPrompt([{ briefId: 'brief-1', context }, { briefId: 'brief-2', context: second }]);
    expect(recompose(result.prompt)).toEqual([{ briefId: 'brief-1', context: originalModelContext(context) }, { briefId: 'brief-2', context: originalModelContext(second) }]);
    expect(result.system).toContain('three distinct thoughts per briefId');
    expect(result.system).toContain('author fit, substance, interest and originality');
    expect(result.system).toContain('rankScore allocates writing, never publication approval');
    expect((result.jsonSchema as any).properties.ideas).toMatchObject({ minItems: 6, maxItems: 6 });
    expect((result.jsonSchema as any).properties.ideas.items.properties.briefId.enum).toEqual(['brief-1', 'brief-2']);
    expect((ORIGINAL_IDEATION_SCHEMA as any).properties.ideas.minItems).toBe(3);
  });

  it('uses one fixed context and mode across idea and writing prompts without dropping boundaries', () => {
    const ideation = buildOriginalIdeationPrompt([{ briefId: 'brief-1', context }]);
    const writing = buildOriginalWritingPrompt({ idea, context });
    expect(recompose(ideation.prompt)[0].context).toEqual(JSON.parse(writing.prompt).context);
    for (const result of [ideation, writing]) {
      expect(result.system).toContain('ownerRestrictions bind');
      expect(result.system).toContain('stylePreferences and editorialSteering guide ranking, not vetoes');
      expect(result.system).toContain('retain attribution and uncertainty');
      expect(result.system).toContain('company claims are not independently verified');
      expect(result.system).toContain('Evidence IDs are subject.sourceIds');
      expect(result.system).toContain('Examples teach diction, rhythm, compression and register only: never copy their wording, facts or premises');
      expect(result.system).toContain('apply forecastExpectations only to predictions');
      expect(result.system).not.toMatch(/frontierLead|aiBullishness|6-12 months/);
    }
    expect(ideation.system).toContain('Choose only permittedModes; contentMode is a default');
  });

  it('permits ideation forecasts and freezes their derived context for writing', () => {
    const ideation = buildOriginalIdeationPrompt([{ briefId: 'brief-1', context }]);
    expect(ideation.system).toContain('Predictions must be forecasts, grounded or explicitly subjective');
    expect(recompose(ideation.prompt)[0].context.subject.permittedModes).toContain('prediction');
    const predictionContext = contextForOriginalMode(context, 'prediction');
    const prediction = { ...idea, publicMove: 'I expect outside testing to matter more as agents handle larger deployments.', contentMode: 'prediction' as const };
    const writing = buildOriginalWritingPrompt({ idea: prediction, context: predictionContext });
    expect(JSON.parse(writing.prompt).context.forecastExpectations).toHaveLength(2);
    expect(JSON.parse(writing.prompt).context.supportedFacts).toEqual(context.supportedFacts);
    expect(writing.system).toContain('apply forecastExpectations only to predictions');
    expect(() => buildOriginalWritingPrompt({ idea: prediction, context })).toThrow('context_mode_mismatch');
  });

  it('returns normalizer-compatible fields without mandatory tension or implication worksheets', () => {
    const schema = (ORIGINAL_IDEATION_SCHEMA as any).properties.ideas.items;
    expect(schema.required).toEqual(['briefId', 'publicMove', 'contentMode', 'evidenceIds', 'supportingReasoning', 'rankScore']);
    expect(schema.properties.publicMove.maxLength).toBe(280);
    expect(schema.properties.rankScore).toMatchObject({ minimum: 0, maximum: 1 });
    expect(schema.required).not.toContain('tension');
    expect(schema.required).not.toContain('implication');
    const writing = buildOriginalWritingPrompt({ idea, context });
    expect((writing.jsonSchema as any).properties.drafts.items.required).toEqual(['ideaId', 'content', 'format', 'posture']);
    expect(writing.system).toContain('three alternatives to the selected thought');
    expect(writing.system).toContain('At most 1200 characters');
  });

  it('honors a narrower publishing payload limit without mutating the default schema', () => {
    const writing = buildOriginalWritingPrompt({ idea, context, maxCharacters: 280 });
    expect((writing.jsonSchema as any).properties.drafts).toMatchObject({ minItems: 3, maxItems: 3 });
    expect((writing.jsonSchema as any).properties.drafts.items.properties.ideaId.enum).toEqual(['idea-1']);
    expect((writing.jsonSchema as any).properties.drafts.items.properties.content.maxLength).toBe(280);
    expect((ORIGINAL_WRITING_SCHEMA as any).properties.drafts.items.properties.content.maxLength).toBe(1200);
    expect(writing.system).toContain('At most 280 characters');
  });

  it('fails before a paid call on ambiguous subjects, mismatched modes or foreign evidence', () => {
    expect(() => buildOriginalIdeationPrompt([])).toThrow('one_or_two_distinct_subjects');
    expect(() => buildOriginalIdeationPrompt(Array(3).fill({ briefId: 'brief-1', context }))).toThrow('one_or_two_distinct_subjects');
    expect(() => buildOriginalIdeationPrompt(Array(2).fill({ briefId: 'brief-1', context }))).toThrow('one_or_two_distinct_subjects');
    expect(() => buildOriginalWritingPrompt({ idea: { ...idea, contentMode: 'prediction' }, context })).toThrow('context_mode_mismatch');
    expect(() => buildOriginalWritingPrompt({ idea: { ...idea, evidenceIds: ['claim-id-not-source-id'] }, context })).toThrow('evidence_outside_subject');
    expect(() => buildOriginalWritingPrompt({ idea, context, maxCharacters: 1201 })).toThrow('character_limit');
  });
});
