import { candidateEditorialDecision, editorialHash, editorialPrompt, parseEditorialAssessment, type EditorialAssessment } from './editorial-contract';
import { getEditorialSafetyFixtures } from './editorial-safety-fixtures';

/** Raw returned assessments and spending identities, never hand-entered pass booleans. */
export interface EditorialSafetyEvaluation {
  id: string;
  suiteHash: string;
  contentHash: string;
  contextHash: string;
  candidateVersion: string;
  model: string;
  requestKey: string;
  spendAttemptIds: string[];
  assessment: EditorialAssessment | null;
}

/** No model calls or writes. An absent/malformed assessment remains unverified. */
export function inspectEditorialSafetyResults(rows: EditorialSafetyEvaluation[], model: string, candidateVersion: string) {
  const suite = getEditorialSafetyFixtures(), inputs = [...suite.negativeCases, ...suite.positiveControls];
  const invalidIds: string[] = [], seen = new Set<string>();
  if (!Array.isArray(rows)) { rows = []; invalidIds.push('invalid_results'); }
  for (const row of rows) {
    const input = inputs.find(item => item.id === row?.id);
    // A case may be judged alone or beside its same-context control. Bind the
    // receipt to that exact final-judge request, not an unrelated paid call.
    const pair = inputs.find(item => item.id === suite.expectations.find(item => item.id === input?.id)?.pairedId);
    const requests = input ? [[input], ...(pair ? [[input, pair], [pair, input]] : [])] : [];
    const requestMatches = requests.some(items => row.requestKey === editorialHash([
      editorialPrompt('final', input!.context), items.map(({ id, content }) => ({ id, content })), model,
    ]));
    if (!input || seen.has(row.id) || row.suiteHash !== suite.hash || row.contentHash !== input.contentHash
      || row.contextHash !== input.contextHash || row.candidateVersion !== suite.candidateVersion
      || row.candidateVersion !== candidateVersion || row.model !== model || !requestMatches
      || !Array.isArray(row.spendAttemptIds) || !row.spendAttemptIds.length
      || !row.spendAttemptIds.every(id => typeof id === 'string' && id.trim()) || !parseEditorialAssessment(row.assessment)) {
      invalidIds.push(row?.id || 'missing_identity');
    }
    if (row?.id) seen.add(row.id);
  }
  const summarize = (input: typeof inputs[number], negative: boolean) => {
    const row = rows.find(item => item?.id === input.id);
    const valid = Boolean(row && !invalidIds.includes(input.id));
    const expectedBlockerPresent = valid && row!.assessment!.hardBlockers.includes(input.case);
    return { id: input.id, case: input.case, verified: valid,
      // Zero tests the hard blockers independently of any fitted editorial cutoff.
      candidateAccepted: valid ? candidateEditorialDecision(row!.assessment, 0).accepted : null,
      expectedBlockerPresent: negative ? expectedBlockerPresent : null,
      assessmentHash: valid ? editorialHash(row!.assessment) : null,
      requestKey: valid ? row!.requestKey : null, spendAttemptIds: valid ? [...row!.spendAttemptIds] : [] };
  };
  const negative = suite.negativeCases.map(input => summarize(input, true));
  const controls = suite.positiveControls.map(input => summarize(input, false));
  const complete = negative.every(row => row.verified) && invalidIds.length === 0;
  const passed = complete && negative.every(row => row.candidateAccepted === false && row.expectedBlockerPresent);
  return { suiteHash: suite.hash, candidateVersion, safetyOnly: true as const, editorialThreshold: 0, complete, passed, invalidIds,
    negative, controls, controlsComplete: controls.every(row => row.verified),
    // Existing policy comparison consumes only outcomes backed by complete receipts.
    outcomes: complete ? negative.map(row => ({ case: row.case, candidateAccepted: row.candidateAccepted! })) : [] };
}
