import { describe, expect, it } from 'vitest';
import { editorialBatchRequest, editorialBatchPayload, parseEditorialBatch } from '../lib/editorial-batch';
import { getEditorialSafetyFixtures } from '../lib/editorial-safety-fixtures';

describe('independent editorial batch', () => {
  const cases = getEditorialSafetyFixtures().negativeCases;
  const items = cases.map(row => ({ id: row.id, content: row.content, context: row.assessmentContext! }));
  it('preserves separate factual and owner boundaries and strips review metadata', () => {
    const payload = editorialBatchPayload(items.map(item => ({ ...item, label: 'rejected', expectedAnswer: 'SECRET_ANSWER' })));
    expect(JSON.stringify(payload)).not.toContain('SECRET_ANSWER');
    for (const [index, candidate] of payload.candidates.entries()) {
      const { authorId, selectedThought, sourceComparators, ...subject } = candidate.context;
      expect({ ...payload.authors[authorId] as object, ...subject }).toEqual(items[index].context.originalEditorialContext);
      expect(selectedThought).toEqual(items[index].context.selectedThought);
      expect(sourceComparators).toEqual(items[index].context.sourceComparators);
    }
  });
  it('binds copy, independent context and model; never includes a global opinion-only instruction', () => {
    const request = editorialBatchRequest(items, 'judge');
    expect(request.system).not.toContain('This is not a prediction.');
    const changed = structuredClone(items);
    changed[0].context.originalEditorialContext.supportedFacts.push('A different fact.');
    expect(editorialBatchRequest(changed, 'judge').requestKey).not.toBe(request.requestKey);
    expect(editorialBatchRequest(items, 'other-judge').requestKey).not.toBe(request.requestKey);
  });
  it('retains incomplete or duplicate paid assessments as pending', () => {
    expect(parseEditorialBatch('{}', ['a'])).toBeNull();
    expect(parseEditorialBatch('{"assessments":[{"id":"a","assessment":null}]}', ['a'])).toBeNull();
    expect(() => editorialBatchPayload([items[0], items[0]])).toThrow('invalid_editorial_batch');
  });
});
