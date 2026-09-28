import { describe, expect, it } from 'vitest';
import {
  assessSourceCopy, bindSourceCopyAssessment, parseSourceCopyAssessment,
  sourceCopyFingerprint, SOURCE_COPY_ASSESSMENT_VERSION,
} from '@/lib/source-copy-assessment';

const sources = [{ id: 'source:revenue', text: 'Cognition has crossed $1B in annualized revenue run rate.' }];
const independent = 'i expect @cognition’s next big growth story to be customers giving devin more work, not just more customers signing up.\n\nthe company says it’s crossed $1B in annualized revenue run rate.';
const judgment = (content = independent, verdict: 'clear' | 'block' | 'uncertain' = 'clear', compared = sources) =>
  bindSourceCopyAssessment({ verdict, explanation: verdict === 'clear'
    ? 'The overlap is the attributed revenue measurement. The growth expectation adds an independently expressed thought.'
    : 'The comparison requires editorial attention.' }, content, compared)!;

describe('source copying as a separate assessment', () => {
  it('retains finance-language overlap without treating the phrase as proof of copying', () => {
    const unresolved = assessSourceCopy(independent, sources);
    expect(unresolved.rawRisk).toBeGreaterThanOrEqual(.3);
    expect(unresolved.matches.join(' ')).toContain('annualized revenue run rate');
    expect(unresolved.duplicate).toBeNull();
    expect(unresolved).toMatchObject({ blocked: false, pending: true, clear: false, reason: 'assessment_unavailable', factualSupport: 'not_assessed' });
    const reviewed = assessSourceCopy(independent, sources, judgment());
    expect(reviewed).toMatchObject({ rawRisk: unresolved.rawRisk, matches: unresolved.matches, blocked: false, pending: false, clear: true, reason: 'semantic_clear', factualSupport: 'not_assessed' });
  });

  it('requires a semantic decision even with no shared wording or with unavailable judgment', () => {
    const differentWords = 'my next hire would run the machines, not manage a hiring funnel.';
    const result = assessSourceCopy(differentWords, sources);
    expect(result.rawRisk).toBe(0);
    expect(result.pending).toBe(true);
    expect(assessSourceCopy(differentWords, sources, judgment(differentWords, 'block')))
      .toMatchObject({ blocked: true, pending: false, clear: false, reason: 'semantic_copy' });
    expect(assessSourceCopy(independent, sources, judgment(independent, 'uncertain')))
      .toMatchObject({ blocked: false, pending: true, clear: false, reason: 'assessment_uncertain' });
  });

  it('blocks full and near-source duplicates regardless of an incorrect clear judgment', () => {
    const expressive = [{ id: 'source:essay', text: 'The keyboard is a passport to a different kind of company. Every unfinished prototype is a departure gate, and the backlog is a map of places nobody has visited.' }];
    for (const content of [expressive[0].text, expressive[0].text.replace('Every unfinished prototype', 'Each unfinished prototype')]) {
      const result = assessSourceCopy(content, expressive, judgment(content, 'clear', expressive));
      expect(result).toMatchObject({ blocked: true, pending: false, clear: false, reason: 'whole_source_duplicate' });
      expect(result.duplicate?.sourceId).toBe('source:essay');
      expect(result.wholeSourceSimilarity).toBeGreaterThanOrEqual(.72);
    }
  });

  it('blocks copied expressive prose identified by the same semantic editor, including attribution', () => {
    const creative = 'The keyboard is a passport to a different kind of company.';
    const source = [{ id: 'source:metaphor', text: `${creative} The report also lists engineering budgets, procurement contracts, manufacturing capacity and a laboratory schedule.` }];
    const content = `As the company puts it: ${creative} I like the idea of the first employee spending their morning talking to customers instead of a compiler.`;
    const before = assessSourceCopy(content, source);
    expect(before.rawRisk).toBeGreaterThanOrEqual(.3);
    expect(before.duplicate).toBeNull();
    expect(before.pending).toBe(true);
    const assessed = bindSourceCopyAssessment({ verdict: 'block', explanation: `Copies the source's distinctive keyboard/passport metaphor: “${creative}” Attribution does not make this independently expressed.` }, content, source);
    expect(assessSourceCopy(content, source, assessed)).toMatchObject({ blocked: true, pending: false, clear: false, reason: 'semantic_copy' });
  });

  it('never certifies unsupported numeric claims or missing attribution as factually safe', () => {
    const inaccurate = independent.replace('$1B', '$2B').replace('the company says ', '');
    const result = assessSourceCopy(inaccurate, sources, judgment(inaccurate));
    expect(result.factualSupport).toBe('not_assessed');
    expect(result).not.toHaveProperty('publishable');
    expect(result).not.toHaveProperty('factualSafety');
    expect(assessSourceCopy(inaccurate, sources).pending).toBe(true);
  });

  it('binds the exact copy, comparison sources and version without mutating snapshots', () => {
    const snapshot = structuredClone(sources);
    const receipt = judgment();
    expect(receipt.sources).toEqual(sources);
    expect(receipt.sources).not.toBe(sources);
    expect(parseSourceCopyAssessment(receipt, sourceCopyFingerprint(independent, sources))).toEqual(receipt);
    expect(assessSourceCopy(`${independent}!`, sources, receipt).pending).toBe(true);
    expect(assessSourceCopy(independent, [{ ...sources[0], text: `${sources[0].text} Correction.` }], receipt).pending).toBe(true);
    expect(assessSourceCopy(independent, sources, { ...receipt, version: 'old' }).pending).toBe(true);
    expect(assessSourceCopy(independent, sources, { ...receipt, sources: [] }).pending).toBe(true);
    expect(bindSourceCopyAssessment(receipt, 'Changed copy', sources)).toBeNull();
    expect(sources).toEqual(snapshot);
  });

  it.each([
    null, {}, [], { verdict: 'allow', explanation: 'wrong enum' },
    { verdict: 'clear', explanation: '' }, { verdict: 'clear', explanation: '   ' },
    { verdict: 'clear', explanation: 'x'.repeat(2001) },
    { verdict: 'clear', explanation: 'No copying.', unexpected: 'unvalidated' },
  ])('defers malformed judgment %j', value => {
    expect(bindSourceCopyAssessment(value, independent, sources)).toBeNull();
    expect(assessSourceCopy(independent, sources, value).pending).toBe(true);
  });

  it('rejects missing fingerprints, sources or a malformed full receipt', () => {
    expect(SOURCE_COPY_ASSESSMENT_VERSION).toBe('source-copy-assessment-1');
    const receipt = judgment();
    for (const value of [
      { ...receipt, fingerprint: undefined }, { ...receipt, sources: undefined },
      { ...receipt, sources: [{ id: '', text: 'unscoped' }] },
      { ...receipt, unexpected: true },
    ]) expect(parseSourceCopyAssessment(value, receipt.fingerprint)).toBeNull();
  });
});
