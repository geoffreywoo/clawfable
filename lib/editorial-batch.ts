import { EDITORIAL_ASSESSMENT_SCHEMA, editorialHash, editorialPrompt, parseEditorialAssessment, type EditorialAssessment, type EditorialContext } from './editorial-contract';
import type { originalAssessmentContext } from './generation-v2';

export const EDITORIAL_BATCH_VERSION = 'independent-editorial-batch-1';
export interface EditorialBatchItem {
  id: string;
  content: string;
  context: ReturnType<typeof originalAssessmentContext>;
}

/** Dictionary encoding only: each copy retains its own complete semantic context.
 * Labels, splits, old judgments and fixture answer keys cannot enter the request.
 */
export function editorialBatchPayload(items: EditorialBatchItem[]) {
  if (!items.length || new Set(items.map(item => item.id)).size !== items.length) throw new Error('invalid_editorial_batch');
  const authors: Record<string, unknown> = {};
  const candidates = items.map(({ id, content, context }) => {
    const { author, ownerRestrictions, stylePreferences, voiceExamples, ...subject } = context.originalEditorialContext;
    const shared = { author, ownerRestrictions, stylePreferences, voiceExamples };
    const authorId = editorialHash(shared);
    authors[authorId] = shared;
    return { id, content, context: { authorId, ...subject, selectedThought: context.selectedThought, sourceComparators: context.sourceComparators } };
  });
  return { authors, candidates };
}

export const INDEPENDENT_EDITORIAL_BATCH_INSTRUCTION = 'Each candidate has its own context. Resolve context.authorId in authors to obtain that candidate’s author, ownerRestrictions, stylePreferences and voiceExamples. The remaining context fields supply only that candidate’s subject, contentMode, facts, uncertainty, previousPremises, selectedThought and sourceComparators. Never transfer facts or restrictions between candidates. Assess each independently; other candidates are not previous published posts, voice examples, or evidence of duplication. Return every id exactly once. Keep each explanation to one short concrete phrase.';

export function editorialBatchRequest(items: EditorialBatchItem[], model: string) {
  const empty: EditorialContext = { contentMode: 'opinion', ownerGuidance: [], supportedFacts: [], unresolvedClaims: [], voiceExamples: [], previousPremises: [] };
  const system = `${editorialPrompt('final', empty, 'batch').system}\n${INDEPENDENT_EDITORIAL_BATCH_INSTRUCTION}`;
  const payload = editorialBatchPayload(items);
  return { system, prompt: JSON.stringify(payload), requestKey: editorialHash([EDITORIAL_BATCH_VERSION, model, system, payload]),
    jsonSchema: { type: 'object', additionalProperties: false, required: ['assessments'], properties: {
      assessments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'assessment'],
        properties: { id: { type: 'string' }, assessment: EDITORIAL_ASSESSMENT_SCHEMA } } },
    } } };
}

export function parseEditorialBatch(text: string, ids: string[]): Array<{id: string; assessment: EditorialAssessment}> | null {
  try {
    const rows = JSON.parse(text)?.assessments;
    if (!Array.isArray(rows) || rows.length !== ids.length || new Set(ids).size !== ids.length) return null;
    const parsed = ids.map(id => {
      const matches = rows.filter(row => row?.id === id);
      const assessment = matches.length === 1 ? parseEditorialAssessment(matches[0].assessment) : null;
      return assessment ? { id, assessment } : null;
    });
    return parsed.every(Boolean) ? parsed : null;
  } catch { return null; }
}
