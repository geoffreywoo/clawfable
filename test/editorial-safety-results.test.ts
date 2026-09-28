import { describe, expect, it } from 'vitest';
import { inspectEditorialSafetyResults, type EditorialSafetyEvaluation } from '@/lib/editorial-safety-results';
import { getEditorialSafetyFixtures } from '@/lib/editorial-safety-fixtures';
import { EDITORIAL_DIMENSIONS, editorialHash, editorialPrompt, type EditorialAssessment } from '@/lib/editorial-contract';

const model = 'active-test-judge';
function fixture(includeControls = false) {
  const suite = getEditorialSafetyFixtures();
  const inputs = [...suite.negativeCases, ...(includeControls ? suite.positiveControls : [])];
  const rows: EditorialSafetyEvaluation[] = inputs.map(input => ({ id: input.id, suiteHash: suite.hash,
    contentHash: input.contentHash, contextHash: input.contextHash, candidateVersion: suite.candidateVersion,
    model, requestKey: editorialHash([editorialPrompt('final', input.context), [{ id: input.id, content: input.content }], model]), spendAttemptIds: [`spend:${input.id}`],
    assessment: { editorialScore: .99, explanation: 'Controlled test response.', diagnostics: [],
      hardBlockers: suite.negativeCases.some(item => item.id === input.id) ? [input.case] : [],
      dimensions: Object.fromEntries(EDITORIAL_DIMENSIONS.map(d => [d, { score: .99, explanation: d }])) as EditorialAssessment['dimensions'] } }));
  return { suite, rows, inspect: () => inspectEditorialSafetyResults(rows, model, suite.candidateVersion) };
}

describe('auditable editorial safety outcomes', () => {
  it('derives rejection from scored hard blockers even with maximum editorial quality', () => {
    const value = fixture(), before = structuredClone(value.rows), report = value.inspect();
    expect(report).toMatchObject({ complete: true, passed: true, controlsComplete: false });
    expect(report.outcomes).toHaveLength(6);
    expect(report.outcomes.every(row => row.candidateAccepted === false)).toBe(true);
    expect(value.rows).toEqual(before);
  });

  it('leaves absent or malformed paid results unverified', () => {
    const value = fixture(); value.rows.pop();
    expect(value.inspect()).toMatchObject({ complete: false, passed: false, outcomes: [] });
    value.rows[0].assessment = null;
    expect(value.inspect().invalidIds).toContain(value.rows[0].id);
  });

  it.each(['suiteHash', 'contentHash', 'contextHash', 'candidateVersion', 'model', 'requestKey', 'spendAttemptIds'] as const)
    ('refuses changed or absent %s provenance', key => {
      const value = fixture();
      (value.rows[0] as any)[key] = key === 'spendAttemptIds' ? [] : key === 'requestKey' ? '' : 'changed';
      expect(value.inspect()).toMatchObject({ complete: false, passed: false, outcomes: [] });
    });

  it('rejects duplicate or unknown result identities', () => {
    const value = fixture(); value.rows.push(structuredClone(value.rows[0]));
    expect(value.inspect().complete).toBe(false);
    value.rows.pop(); value.rows[0].id = 'unknown';
    expect(value.inspect().complete).toBe(false);
  });

  it('leaves malformed stored JSON unverified without throwing', () => {
    const value = fixture();
    for (const rows of [null, {}, [null]]) {
      expect(inspectEditorialSafetyResults(rows as any, model, value.suite.candidateVersion).passed).toBe(false);
    }
    (value.rows[0] as any).requestKey = 123;
    expect(value.inspect().passed).toBe(false);
    value.rows[0].requestKey = fixture().rows[0].requestKey;
    (value.rows[0].assessment as any).explanation = 123;
    expect(value.inspect().passed).toBe(false);
  });

  it('binds the exact standalone or paired request and refuses unrelated paid request identities', () => {
    const value = fixture(true), first = value.suite.negativeCases[0], control = value.suite.positiveControls[0];
    const key = editorialHash([editorialPrompt('final', first.context), [first, control].map(({ id, content }) => ({ id, content })), model]);
    value.rows[0].requestKey = key; value.rows[6].requestKey = key;
    expect(value.inspect().passed).toBe(true);
    value.rows[0].requestKey = 'unrelated-paid-request';
    expect(value.inspect().passed).toBe(false);
  });

  it('does not hide missing factual blockers behind a low style score or the wrong diagnosis', () => {
    const value = fixture(); value.rows[0].assessment!.editorialScore = 0;
    value.rows[0].assessment!.hardBlockers = [];
    expect(value.inspect()).toMatchObject({ complete: true, passed: false });
    expect(value.inspect().negative[0].candidateAccepted).toBe(true);
    value.rows[0].assessment!.hardBlockers = ['invalid_payload'];
    expect(value.inspect().negative[0].candidateAccepted).toBe(false);
    expect(value.inspect().passed).toBe(false);
  });

  it('reports paired control behavior separately from negative-case completeness', () => {
    const value = fixture(true), report = value.inspect();
    expect(report).toMatchObject({ complete: true, passed: true, controlsComplete: true });
    expect(report.controls.every(row => row.candidateAccepted === true)).toBe(true);
    // Rejecting an otherwise safe control is visible; it never becomes owner dislike.
    value.rows[6].assessment!.hardBlockers = ['unsupported_fact'];
    expect(value.inspect().controls[0].candidateAccepted).toBe(false);
  });
});
