import { describe, expect, it } from 'vitest';
import { editorialHash, editorialPrompt } from '@/lib/editorial-contract';
import { buildOriginalEditorialContext, contextForOriginalMode, ORIGINAL_EDITORIAL_CONTEXT_MAX_CHARS, type OriginalVoiceExample } from '@/lib/original-editorial-context';
import type { VoiceProfile } from '@/lib/soul-parser';
import type { SubjectPacket } from '@/lib/subject-packet';
import { buildAntiFundPortfolioContext, getAntiFundPortfolioCompany } from '@/lib/antifund-portfolio';

const profile: VoiceProfile = { accountHandle: 'geoffwoo', summary: 'Founder and investor.', topics: ['AI', 'manufacturing'], tone: 'direct', communicationStyle: 'casual; fragments are fine', antiGoals: ['Never invent personal experience.'] };
const subject: SubjectPacket = { version: 'subject-packet-1', subject: 'Cognition agent pricing', sourceIds: ['source-a'], supportedFacts: ['Cognition says its agent costs $10.'], unverifiedContext: 'Unverified: adoption is growing.', permittedModes: ['opinion', 'prediction', 'factual_claim', 'observation'], observedAt: '2026-09-28T00:00:00Z', expiresAt: '2026-09-29T00:00:00Z', interest: { kind: 'research', relevance: .9 } };
const example = (id: string, overrides: Partial<OriginalVoiceExample> = {}): OriginalVoiceExample => ({ id, content: `A concrete owner example ${id}.`, provenance: 'operator_composed', dispositions: ['diction_anchor'], ...overrides });
const build = (overrides: Partial<Parameters<typeof buildOriginalEditorialContext>[0]> = {}) => buildOriginalEditorialContext({ voiceProfile: profile, subject, contentMode: 'opinion', voiceExamples: [example('a')], ...overrides });

describe('one original editorial context', () => {
  it('isolates the real enriched-profile shape from legacy rubrics, example banks and model lessons', () => {
    const enrichedStyle = [
      'casual; fragments are fine',
      'Style analysis: generated style analysis that is not owner coaching',
      '## OPERATOR VOICE REFERENCE (manual/operator-written tweets are high-signal — match voice)',
      `Voice anchors: ${'unfiltered historical premise '.repeat(180)}`,
      '## OPERATOR VOICE DIRECTIVES (permanent rules from coaching — follow these)',
      '1. Avoid disclosing private data.\n   Lesson: generated duplicate lesson\n   Scope: topic / avoid: private revenue\n   Raw coaching: Never disclose private revenue, except numbers I have already published.',
      '2. Lead directly.\n   Lesson: generated duplicate lesson\n   Scope: hook / prefer: company judgment\n   Raw coaching: Lead with the company judgment; use one fact as support.',
      'Note: If any directives seem contradictory, prefer the MORE RECENT ones (higher numbers).',
      '## PERSONALIZATION MEMORY\n## NEVER DO THIS AGAIN',
      '- Model criticism: every AI opinion must have a frontierLead score of 0.9.',
      '## OPERATOR HIDDEN PREFERENCES\n- Mandatory 6-12 month forecast rubric.',
      `## HIGH-PERFORMING REFERENCE BANK\n${'another historical premise '.repeat(180)}`,
      '## IDENTITY CONSTRAINTS\n- Generated duplicate of coaching.',
    ].join('\n');
    const context = build({ voiceProfile: { ...profile, communicationStyle: enrichedStyle } });
    const serialized = JSON.stringify(context);
    expect(enrichedStyle.length).toBeGreaterThan(10_000);
    expect(serialized.length).toBeLessThan(7000);
    expect(context.stylePreferences.find(rule => rule.id === 'soul:style:1')?.text).toBe('casual; fragments are fine');
    expect(context.ownerRestrictions.map(rule => rule.text)).toContain('1. Never disclose private revenue, except numbers I have already published.');
    expect(context.stylePreferences.map(rule => rule.text)).toContain('2. Lead with the company judgment; use one fact as support.');
    expect(context.ownerGuidance.join(' ')).toContain('higher numbers');
    expect(serialized).not.toMatch(/unfiltered historical premise|another historical premise|frontierLead|6-12|generated duplicate|generated style analysis/i);
    expect(context.voiceExamples).toEqual([example('a').content]);
    expect(context.excludedApplicationSections).toContain('OPERATOR VOICE REFERENCE');
    expect(context.supportedFacts).toEqual(subject.supportedFacts);
  });

  it('preserves unknown owner sections and fails closed on unfamiliar coaching formats', () => {
    const context = build({ voiceProfile: { ...profile, communicationStyle: 'terse\n\n## My custom boundary\nNever name private customers.' } });
    expect(context.stylePreferences.map(rule => rule.text).join(' ')).toContain('Never name private customers.');
    expect(() => build({ voiceProfile: { ...profile, communicationStyle: 'terse\n\n## OPERATOR VOICE DIRECTIVES\nNever expose private revenue.' } }))
      .toThrow('original_editorial_directive_format_unrecognized');
  });

  it('bounds complete fields and the total contract without cutting restrictions or evidence', () => {
    const restriction = `Never disclose ${'private '.repeat(230)}unless the owner approves.`;
    expect(() => build({ voiceProfile: { ...profile, antiGoals: [restriction] } })).toThrow('original_editorial_context_limit:guidance.soul:anti-goal:0');
    expect(() => build({ subject: { ...subject, supportedFacts: [`Claim with attribution ${'evidence '.repeat(300)}`] } })).toThrow('original_editorial_context_limit:supportedFact');
    expect(() => build({ subject: { ...subject, supportedFacts: Array.from({ length: 30 }, (_, index) => `Source ${index} says: ${'evidence '.repeat(100)}`) } }))
      .toThrow(`original_editorial_context_limit:total:${ORIGINAL_EDITORIAL_CONTEXT_MAX_CHARS}`);
    const context = build({ subject: { ...subject, supportedFacts: ['Company says revenue is $10m; this is unaudited.'] } });
    expect(context.supportedFacts[0]).toBe('Company says revenue is $10m; this is unaudited.');
  });

  it('preserves the exact context for ideas, writing, judgment and repair', () => {
    const context = build();
    const hash = editorialHash(context);
    const idea = editorialPrompt('idea', context), writer = editorialPrompt('writing', context), judge = editorialPrompt('final', context);
    const repair = editorialPrompt('writing', context);
    for (const stage of [idea, writer, judge, repair]) {
      expect(stage.context).toMatchObject(context);
      expect(stage.context.supportedFacts).toEqual(['Cognition says its agent costs $10.']);
      expect(stage.context.unresolvedClaims).toEqual(['Unverified: adoption is growing.']);
      expect(stage.context.voiceExamples).toEqual(context.voiceExamples);
    }
    expect(editorialHash(context)).toBe(hash);
    expect(context.subject.expiresAt).toBe(subject.expiresAt);
    expect(context.exampleUse).toContain('no facts, personal experience or new premises');
    expect(context.exampleUse).toContain('Sharing a topic or informal rhythm alone is not a duplicate');
  });

  it('separates hard owner restrictions from style preferences without expanding preferences into vetoes', () => {
    const context = build({ ownerGuidance: [
      { id: 'owner:no-numbers', text: 'Do not disclose private revenue.', kind: 'restriction', source: 'owner_directive' },
      { id: 'owner:brief', text: 'Prefer short opinions.', kind: 'preference', source: 'owner_directive' },
    ] });
    expect(context.ownerRestrictions.map(rule => rule.text)).toContain('Do not disclose private revenue.');
    expect(context.ownerRestrictions.map(rule => rule.text)).toContain('Never invent personal experience.');
    expect(context.stylePreferences.map(rule => rule.text)).toContain('Prefer short opinions.');
    expect(context.ownerRestrictions.some(rule => rule.text.includes('Prefer short'))).toBe(false);
    expect(context.ownerGuidance).toContain('Style preference, assessed editorially: Prefer short opinions.');
  });

  it('keeps Geoffrey policies in account context including portfolio boundaries', () => {
    const portfolio = buildAntiFundPortfolioContext(getAntiFundPortfolioCompany('cognition')!, 'live_development');
    const context = build({ portfolioCompanyContext: portfolio });
    const restrictions = context.ownerRestrictions.map(rule => rule.text).join(' ');
    expect(restrictions).toContain('Do not autonomously amplify Cursor');
    expect(restrictions).toContain('Do not publish sports');
    expect(restrictions).toContain('Do not promote Natural');
    expect(restrictions).toContain('OpenAI and Cognition');
    expect(restrictions).toContain('Keep Cognition as the named subject');
    expect(restrictions).toContain('constructive, company-specific conviction');
    expect(restrictions).toContain('Do not disparage');
    expect(restrictions).toContain('does not establish personal experience');
    const other = build({ voiceProfile: { ...profile, accountHandle: 'anotherowner', summary: 'Another author.' } });
    expect(other.ownerRestrictions.some(rule => rule.id.startsWith('account:'))).toBe(false);
  });

  it('uses at most three relevant, provenance-checked examples with traceable identities', () => {
    const context = build({ voiceExamples: [
      example('generated', { provenance: 'known_clawfable_generated', relevance: 100 }),
      example('unknown', { provenance: 'unknown' }),
      example('unattested', { provenance: 'timeline_unmatched' }),
      example('negative', { dispositions: ['negative', 'diction_anchor'] }),
      example('copied', { copied: true }),
      example('holdout', { reservedForEvaluation: true }),
      example('mechanics', { dispositions: ['mechanics_only', 'diction_anchor'] }),
      example('nonanchor', { dispositions: ['topic_signal'] }),
      example('too-long', { content: 'x'.repeat(801) }),
      example('low', { relevance: .1 }),
      example('attested', { provenance: 'timeline_unmatched', authorshipAttestationId: 'owner-attestation', relevance: .9 }),
      example('best', { relevance: 1 }),
      example('best', { content: 'Different text with the same identity.', relevance: .8 }),
      example('same-text', { content: '  A concrete OWNER example best. ', relevance: .7 }),
      example('middle', { relevance: .5 }),
    ] });
    expect(context.exampleRefs.map(ref => ref.id)).toEqual(['best', 'attested', 'middle']);
    expect(context.exampleRefs[1].authorshipAttestationId).toBe('owner-attestation');
    expect(context.voiceExamples).toHaveLength(3);
    expect(context.supportedFacts.some(fact => fact.includes('owner example'))).toBe(false);
  });

  it('limits forecast expectations to prediction mode regardless of AI subject', () => {
    const opinion = build();
    expect(opinion.forecastExpectations).toEqual([]);
    expect(opinion.modeGuidance).toContain('complete on its own');
    expect(JSON.stringify(opinion)).not.toMatch(/6-12|frontierLead|aiBullishness|ahead-of-consensus/);
    const prediction = build({ contentMode: 'prediction' });
    expect(prediction.forecastExpectations).toHaveLength(2);
    expect(prediction.forecastExpectations.join(' ')).toContain('never an established fact');
    expect(prediction.supportedFacts).toEqual(opinion.supportedFacts);
    expect(() => build({ subject: { ...subject, permittedModes: ['opinion'] }, contentMode: 'factual_claim' })).toThrow('subject_content_mode_not_permitted');
  });

  it('derives a permitted selected mode while changing only its three mode fields', () => {
    const original = build();
    const prediction = contextForOriginalMode(original, 'prediction');
    const modeFields = new Set(['contentMode', 'modeGuidance', 'forecastExpectations']);
    for (const key of Object.keys(original) as Array<keyof typeof original>) {
      if (!modeFields.has(key)) expect(prediction[key]).toBe(original[key]);
    }
    expect(original.contentMode).toBe('opinion');
    expect(original.forecastExpectations).toEqual([]);
    expect(prediction.contentMode).toBe('prediction');
    expect(prediction.forecastExpectations).toHaveLength(2);
    const backToOpinion = contextForOriginalMode(prediction, 'opinion');
    expect(backToOpinion).toEqual(original);
    expect(() => contextForOriginalMode({ ...original, subject: { ...original.subject, permittedModes: ['opinion'] } }, 'prediction')).toThrow('subject_content_mode_not_permitted');
  });

  it('keeps verified handles and bounded premise memory in the same payload without mutating inputs', () => {
    const original = JSON.stringify(subject);
    const context = build({ previousPremises: Array.from({ length: 20 }, (_, i) => `Prior thought ${i}`), verifiedEntityMentions: [
      { entity: 'Cognition', handle: 'cognition', role: 'company', source: 'curated_registry' },
    ] });
    expect(context.previousPremises).toHaveLength(12);
    expect(context.ownerRestrictions.find(rule => rule.id === 'account:verified-mentions')?.text).toContain('Cognition = @cognition');
    expect(JSON.stringify(subject)).toBe(original);
    context.subject.sourceIds.push('another');
    expect(subject.sourceIds).toEqual(['source-a']);
  });
});
