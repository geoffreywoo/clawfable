import { describe, expect, it } from 'vitest';
import {
  buildResearchSemanticKey,
  canonicalizeResearchUrl,
  parseSyndicationFeed,
  researchTokenSimilarity,
  stableResearchId,
} from '@/lib/research-utils';

describe('research utilities', () => {
  it('canonicalizes URLs without campaign parameters or fragments', () => {
    expect(canonicalizeResearchUrl('HTTPS://Example.COM//news/item/?utm_source=x&b=2&a=1#section')).toBe(
      'https://example.com/news/item?a=1&b=2',
    );
    expect(canonicalizeResearchUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalizeResearchUrl('https://user:secret@example.com/story')).toBeNull();
  });

  it('marks missing publication dates as unknown instead of making stale entries look fresh', () => {
    const [entry] = parseSyndicationFeed(`
      <rss><channel><item>
        <title>Undated archive item</title>
        <link>https://example.com/archive</link>
        <description>An old item without publication metadata.</description>
      </item></channel></rss>`);

    expect(entry.publishedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('parses RSS and Atom entries into one canonical shape', () => {
    const xml = `
      <rss><channel><item>
        <title><![CDATA[Model &amp; market update]]></title>
        <link>https://example.com/story?utm_campaign=test</link>
        <pubDate>Fri, 31 Jul 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[<p>A concrete result changed buyer behavior.</p>]]></description>
      </item></channel></rss>
      <feed><entry>
        <title>Release v2</title>
        <link rel="alternate" href="https://github.com/acme/tool/releases/tag/v2" />
        <updated>2026-07-31T13:00:00Z</updated>
        <summary>Ships the stable API.</summary>
      </entry></feed>`;

    expect(parseSyndicationFeed(xml)).toEqual([
      expect.objectContaining({
        title: 'Model & market update',
        url: 'https://example.com/story',
        excerpt: 'A concrete result changed buyer behavior.',
      }),
      expect.objectContaining({
        title: 'Release v2',
        url: 'https://github.com/acme/tool/releases/tag/v2',
      }),
    ]);
  });

  it('builds stable semantic IDs while recognizing synonym-level token reskins', () => {
    expect(stableResearchId('source', 'HTTPS://EXAMPLE.COM')).toBe(stableResearchId('source', 'https://example.com'));
    expect(buildResearchSemanticKey('OpenAI releases a lower-cost inference model', ['OpenAI'])).toContain('openai');
    expect(researchTokenSimilarity(
      'founders should measure repeated buyer behavior before calling something product market fit',
      'product market fit requires repeat customer behavior, not launch attention',
    )).toBeGreaterThan(0.45);
  });
});
