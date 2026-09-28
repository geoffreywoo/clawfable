import { describe, expect, it } from 'vitest';
import { buildOriginalEditorialContext, contextForOriginalMode } from '@/lib/original-editorial-context';
import { buildOriginalIdeationPrompt, buildOriginalWritingPrompt, ORIGINAL_IDEATION_SCHEMA, ORIGINAL_WRITING_SCHEMA, type OriginalSelectedThought } from '@/lib/original-prompts';

const context = buildOriginalEditorialContext({
  voiceProfile: { accountHandle: 'anotherowner', summary: 'An operator.', tone: 'direct', communicationStyle: 'casual', topics: ['AI'], antiGoals: ['Do not disclose private customer information.'] },
  subject: { version: 'subject-packet-1', subject: 'Agent deployment', sourceIds: ['source-a'], supportedFacts: ['Acme says its agent passed its internal test.'], unverifiedContext: 'Unverified launch rumor.', permittedModes: ['observation', 'opinion', 'prediction'], observedAt: '2026-09-28T00:00:00Z', expiresAt: '2026-09-29T00:00:00Z', interest: { kind: 'research', relevance: .9 } },
  contentMode: 'observation', voiceExamples: [{ id: 'owner-1', content: 'A direct owner-written thought.', provenance: 'operator_composed', dispositions: ['diction_anchor'] }],
});
const idea: OriginalSelectedThought = { id: 'idea-1', briefId: 'brief-1', publicMove: 'Acme says its agent passed its own test. I want to see the outside test.', contentMode: 'observation', evidenceIds: ['source-a'], supportingReasoning: null };

describe('compact original prompts', () => {
  it('requests three different thoughts for each of two subjects in one call payload', () => {
    const second = { ...context, subject: { ...context.subject, subject: 'Robotics tooling' } };
    const result = buildOriginalIdeationPrompt([{ briefId: 'brief-1', context }, { briefId: 'brief-2', context: second }]);
    expect(JSON.parse(result.prompt).subjects).toEqual([{ briefId: 'brief-1', context }, { briefId: 'brief-2', context: second }]);
    expect(result.system).toContain('exactly three different thoughts for EACH');
    expect(result.system).toContain('author fit, concrete relevance, interest and originality');
    expect(result.system).toContain('self-ranking allocates writing effort and cannot approve publication');
    expect((result.jsonSchema as any).properties.ideas).toMatchObject({ minItems: 6, maxItems: 6 });
    expect((result.jsonSchema as any).properties.ideas.items.properties.briefId.enum).toEqual(['brief-1', 'brief-2']);
    expect((ORIGINAL_IDEATION_SCHEMA as any).properties.ideas.minItems).toBe(3);
  });

  it('uses one fixed context and mode across idea and writing prompts without dropping boundaries', () => {
    const ideation = buildOriginalIdeationPrompt([{ briefId: 'brief-1', context }]);
    const writing = buildOriginalWritingPrompt({ idea, context });
    expect(JSON.parse(ideation.prompt).subjects[0].context).toEqual(JSON.parse(writing.prompt).context);
    for (const result of [ideation, writing]) {
      expect(result.system).toContain('ownerRestrictions are binding');
      expect(result.system).toContain('stylePreferences are editorial guidance');
      expect(result.system).toContain('Preserve every says, claims, reports');
      expect(result.system).toContain('Evidence IDs are source-document IDs');
      expect(result.system).toContain('Examples teach rhythm and register only');
      expect(result.system).toContain("Apply forecast expectations only when the thought's contentMode is prediction");
      expect(result.system).not.toMatch(/frontierLead|aiBullishness|6-12 months/);
    }
    expect(ideation.system).toContain("Choose each thought's contentMode from that subject's permittedModes");
  });

  it('permits ideation forecasts and freezes their derived context for writing', () => {
    const ideation = buildOriginalIdeationPrompt([{ briefId: 'brief-1', context }]);
    expect(ideation.system).toContain('Predictions are permitted when listed');
    expect(JSON.parse(ideation.prompt).subjects[0].context.subject.permittedModes).toContain('prediction');
    const predictionContext = contextForOriginalMode(context, 'prediction');
    const prediction = { ...idea, publicMove: 'I expect outside testing to matter more as agents handle larger deployments.', contentMode: 'prediction' as const };
    const writing = buildOriginalWritingPrompt({ idea: prediction, context: predictionContext });
    expect(JSON.parse(writing.prompt).context.forecastExpectations).toHaveLength(2);
    expect(JSON.parse(writing.prompt).context.supportedFacts).toEqual(context.supportedFacts);
    expect(writing.system).toContain('Follow context.modeGuidance and forecastExpectations');
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
    expect(writing.system).toContain('exactly three alternatives to the one selected thought');
    expect(writing.system).toContain('at most 1200 characters');
  });

  it('honors a narrower publishing payload limit without mutating the default schema', () => {
    const writing = buildOriginalWritingPrompt({ idea, context, maxCharacters: 280 });
    expect((writing.jsonSchema as any).properties.drafts).toMatchObject({ minItems: 3, maxItems: 3 });
    expect((writing.jsonSchema as any).properties.drafts.items.properties.ideaId.enum).toEqual(['idea-1']);
    expect((writing.jsonSchema as any).properties.drafts.items.properties.content.maxLength).toBe(280);
    expect((ORIGINAL_WRITING_SCHEMA as any).properties.drafts.items.properties.content.maxLength).toBe(1200);
    expect(writing.system).toContain('at most 280 characters');
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
