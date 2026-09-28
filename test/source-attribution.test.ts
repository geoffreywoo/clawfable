import { describe, expect, it } from 'vitest';
import { getSourceAttributionIssueV2 } from '@/lib/generation-v2';
import { assessExternalSourceCopyRisk } from '@/lib/account-taste';
import type { SourceDocument } from '@/lib/types';

const source = {
  sourceType: 'x', isPrimary: true, publisher: '@cognition', entities: ['Cognition', 'Devin'],
  claims: [{ text: 'The company says it crossed $1B in annualized revenue run rate.' }],
} as SourceDocument;
const saved = 'smart move by @cognition to make its milestone post a customer showcase. it says it crossed $1B in annualized revenue run rate and highlights customers building with Devin.\n\nmaking your customer look like a genius is a better pitch than making your product look like one.';
const check = (text: string, documents = [source]) => getSourceAttributionIssueV2(text, documents, true);

describe('adjacent primary-source attribution', () => {
  it('recognizes the exact saved draft without changing source-copy or final editorial decisions', () => {
    expect(check(saved)).toBeNull();
    expect(assessExternalSourceCopyRisk(saved, ['Cognition has crossed $1B in annualized revenue run rate.']).score).toBeGreaterThanOrEqual(.3);
    // The new resolver is confined to the durable primary-claim path.
    expect(getSourceAttributionIssueV2(saved, [source])).toContain('attribution');
  });

  it.each([
    '@cognition published an update. It says revenue reached $1B.',
    'smart move by @COGNITION to publish its update. It reports revenue of $1B.',
    '@cognition published an update today. It claims revenue of $1.2B.',
    '@cognition published an update.\nIt states revenue of $1B.',
  ])('retains source attribution in adjacent declarative copy: %s', content => {
    expect(check(content)).toBeNull();
  });

  it.each([
    'It says revenue reached $1B.',
    '@cognition published an update. Revenue reached $1B.',
    '@other published an update. It says revenue reached $1B.',
    '@cognition_news published an update. It says revenue reached $1B.',
    '@cognition and @other published updates. It says revenue reached $1B.',
    '@cognition and Devin are in the update. It says revenue reached $1B.',
    '@cognition published an update. The weather is nice. It says revenue reached $1B.',
    '@cognition published an update.\n\nIt says revenue reached $1B.',
    'I read @cognition’s competitor’s announcement. It says revenue reached $1B.',
    'smart move by @cognition’s competitor to publish an update. It says revenue reached $1B.',
    '@cognition quoted an analyst. It says revenue reached $1B.',
    '@cognition shared another announcement. It says revenue reached $1B.',
    '@cognition might publish an update. It says revenue reached $1B.',
    '@cognition has not published the update. It says revenue reached $1B.',
    '@cognition bought Acme. It says revenue reached $1B.',
    'a startup backed by @cognition launched yesterday. It says revenue reached $1B.',
    '@cognition has a new subsidiary. It says revenue reached $1B.',
    '@cognition published a subsidiary’s update. It says revenue reached $1B.',
    '@cognition published an update from Acme. It says revenue reached $1B.',
    'smart move by @cognition to buy Acme and publish its update. It says revenue reached $1B.',
    'smart move by @cognition to make its milestone post feature Acme. It says revenue reached $1B.',
    'smart move by @cognition to publish its update, unlike Acme. It says revenue reached $1B.',
    '“smart move by @cognition.” It says revenue reached $1B.',
    'imagine an update by @cognition. It says revenue reached $1B.',
    'an update by @cognition? It says revenue reached $1B.',
    '@cognition published an update. If it says revenue reached $1B, that would be interesting.',
    '@cognition published an update. Does it say revenue reached $1B?',
    '@cognition published an update. It does not say revenue reached $1B.',
    '@cognition published an update. It allegedly says revenue reached $1B.',
    '@cognition published an update. It says revenue reached $1B?',
    '@cognition published an update. It says nothing about revenue. Revenue reached $1B.',
    '@cognition published an update. "It says revenue reached $1B."',
  ])('keeps missing, ambiguous or nonasserted attribution blocked: %s', content => {
    expect(check(content)).toContain('attribution');
  });

  it('requires a primary X publisher and rejects another recorded source entity', () => {
    expect(check(saved, [{ ...source, isPrimary: false }])).toContain('attribution');
    expect(check(saved, [{ ...source, sourceType: 'web' as SourceDocument['sourceType'] }])).toContain('attribution');
    expect(check(saved, [{ ...source, publisher: 'Cognition' }])).toContain('attribution');
    expect(check('@cognition challenged RivalCo. It says revenue reached $1B.', [source, {
      ...source, publisher: '@rival', entities: ['RivalCo'],
    }])).toContain('attribution');
  });
});
