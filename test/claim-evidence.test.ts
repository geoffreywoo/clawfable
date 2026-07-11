import { describe, expect, it } from 'vitest';
import { assessClaimEvidence } from '@/lib/claim-evidence';
import { assessGeneratedWritingPatterns, scoreWritingPatternReuse } from '@/lib/writing-patterns';

describe('claim evidence', () => {
  it('blocks invented anonymous anecdotes even when they sound technically specific', () => {
    const result = assessClaimEvidence(
      'A machine shop owner showed me two carbide end mills. One ran 11 hours. One chipped after 47 minutes.',
      ['Tungsten carbide tooling depends on powder metallurgy, binder chemistry, and qualification.'],
    );

    expect(result.risk).toBeGreaterThanOrEqual(0.8);
    expect(result.personalExperienceSupported).toBe(false);
    expect(result.unsupportedNumbers).toEqual(expect.arrayContaining(['11hours', '47minutes']));
    expect(result.issue).toContain('personal anecdote');
  });

  it('allows a personal claim when it is grounded in a matching operator anchor', () => {
    const anchor = 'i remember this trip. i had a call with scott and zach to invest in the cognition series A at $2b.';
    const result = assessClaimEvidence(anchor, [anchor]);

    expect(result.risk).toBe(0);
    expect(result.personalExperienceSupported).toBe(true);
    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('requires precise numbers to appear in supplied evidence', () => {
    expect(assessClaimEvidence('The line lost 9 days to bearing failure.', ['Bearing failures stop production.']).risk).toBeGreaterThanOrEqual(0.5);
    expect(assessClaimEvidence('The line lost 9 days to bearing failure.', ['The incident report says the line lost 9 days.']).risk).toBe(0);
    expect(assessClaimEvidence('The meeting gets 10x more serious.', ['The portfolio was worth $10b.']).risk).toBeGreaterThan(0.4);
  });

  it('catches unsupported operational precision written as number words', () => {
    const invented = assessClaimEvidence(
      'bro you have three API calls, two are wrappers, and the third returns null.',
      [],
    );
    const supported = assessClaimEvidence(
      'bro you have three API calls, two are wrappers, and the third returns null.',
      ['The product currently exposes three API calls.'],
    );

    expect(invented.unsupportedNumbers).toContain('3apicalls');
    expect(invented.risk).toBeGreaterThanOrEqual(0.5);
    expect(supported.risk).toBe(0);
    expect(assessClaimEvidence('fusion has four clocks: plasma, fuel, wall, inventory.', []).risk).toBe(0);
  });
});

describe('generated writing patterns', () => {
  it('detects repeated anonymous-anecdote scaffolds', () => {
    const candidate = 'A founder showed me an inspection robot. The exception path preserved the labor.';
    const assessment = assessGeneratedWritingPatterns(candidate);
    const reuse = scoreWritingPatternReuse(candidate, [
      'A machine shop owner showed me two end mills.',
      'A founder showed me a customer call.',
    ]);

    expect(assessment.hits).toContain('anonymous-anecdote');
    expect(reuse).toBeGreaterThanOrEqual(0.6);
  });

  it('treats repeated how-to openings as one generated scaffold', () => {
    expect(assessGeneratedWritingPatterns('how to diligence a magnet company: ask about coercivity.').primarySignature).toBe('how-to-open');
    expect(scoreWritingPatternReuse(
      'how to raise frontier capital: bring the failed sample.',
      ['how to diligence a magnet company: ask about coercivity.'],
    )).toBeGreaterThanOrEqual(0.4);
  });

  it('detects generated contrasts and rhetorical reskins split across lines', () => {
    const splitContrast = assessGeneratedWritingPatterns(
      'your hardware startup does not have a prototype.\n\nit has one unusually cooperative specimen.',
    );
    const nounVerb = assessGeneratedWritingPatterns(
      'ore is the easy noun. purification, morphology and qualification are the verbs.',
    );
    const slideReality = assessGeneratedWritingPatterns(
      'datacenter powerpoint:\n\ncompute forever\n\nphysical world:\n\ntransformer lead time',
    );
    const topicLabel = assessGeneratedWritingPatterns(
      'creator economy question:\n\nwho owns provenance?',
    );

    expect(splitContrast.hits).toContain('split-not-x-y');
    expect(splitContrast.score).toBeGreaterThanOrEqual(0.5);
    expect(nounVerb.hits).toContain('noun-verb-gimmick');
    expect(slideReality.hits).toContain('slide-reality-scaffold');
    expect(topicLabel.hits).toContain('topic-question-label');
  });
});
