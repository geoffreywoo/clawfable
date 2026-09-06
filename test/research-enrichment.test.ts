import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichSourceDocuments } from '@/lib/research-pipeline';
import { generateText } from '@/lib/ai';
import type { SourceDocument } from '@/lib/types';

vi.mock('@/lib/ai', async (original) => ({
  ...await original<typeof import('@/lib/ai')>(),
  hasTextGenerationProvider: () => true,
  generateText: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it('bounds extraction, retains late qualifiers, rejects invented claims and ignores unrequested documents', async () => {
  const qualifier = 'The vendor reports up to 35x lower cost; independent review is pending.';
  const documents = Array.from({ length: 10 }, (_, index) => ({
    schemaVersion: 2, id: `doc-${index}`, agentId: 'test', sourceType: 'official',
    canonicalUrl: `https://openai.com/news/${index}`, title: `Source ${index}`, publisher: 'Publisher',
    publishedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(),
    trustTier: 'primary', isPrimary: true,
    excerpt: `${'A previous source sentence. '.repeat(65)}${qualifier}`,
    contentHash: `hash-${index}`, entities: [], topics: ['AI'], query: null, metadata: {},
    claims: [{ id: `raw-${index}`, text: 'Original source claim stays intact.', kind: 'fact', confidence: 0.7, entities: [] }],
  } satisfies SourceDocument));
  vi.mocked(generateText).mockImplementation(async (options) => {
    const items = JSON.parse(options.prompt!).items;
    expect(items).toHaveLength(8);
    expect(items[0].excerpt).toContain(qualifier);
    expect(options).toMatchObject({ task: 'source_enrichment', maxTokens: 6400,
      jsonSchema: { additionalProperties: false, required: ['items'] } });
    return {
      text: JSON.stringify({ items: [
        { id: 'doc-0', entities: [], claims: [{ text: qualifier, kind: 'measurement', confidence: 0.7, entities: [] }] },
        { id: 'doc-1', entities: [], claims: [{ text: 'Independent review confirms 350x lower cost.', kind: 'measurement', confidence: 1, entities: [] }] },
        { id: 'doc-9', entities: ['Injected'], claims: [] },
      ] }),
      provider: 'openai', model: 'gpt-5.5', providerModel: 'gpt-5.5-2026-04-23',
      requestedModel: 'gpt-5.5', requestedProvider: 'openai', reasoningEffort: 'none',
      inputTokens: 500, outputTokens: 100, stopReason: 'end_turn',
    };
  });
  const trace = vi.fn();
  const result = await enrichSourceDocuments(documents, 'publishing_v2_astra', trace);
  expect(result[0].claims[0].text).toBe(qualifier);
  expect(result[1].claims).toEqual(documents[1].claims);
  expect(result[9]).toBe(documents[9]);
  expect(trace).toHaveBeenCalledWith(expect.objectContaining({
    providerModel: 'gpt-5.5-2026-04-23', requestedModel: 'gpt-5.5', reasoningEffort: 'none', succeeded: true,
  }));
});
