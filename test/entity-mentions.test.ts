import { describe, expect, it } from 'vitest';
import {
  buildVerifiedEntityMentions,
  CURATED_X_ENTITY_REGISTRY_VERSION,
  findCuratedVerifiedEntityMentions,
  getCuratedEntityMentionPolicyIssue,
  getDeprecatedCuratedEntityHandleIssue,
  getMissingVerifiedEntityTagIssue,
  isLeadingXMention,
  mergeVerifiedEntityMentions,
  usedCuratedVerifiedMentionHandles,
  usedVerifiedMentionHandles,
  xIdentityMatchesEntity,
} from '@/lib/entity-mentions';
import type { SourceDocument } from '@/lib/types';

function xDocument(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    schemaVersion: 2,
    id: 'source-openai',
    agentId: 'agent-1',
    sourceType: 'x',
    canonicalUrl: 'https://x.com/sama/status/1',
    title: 'Sam Altman on AI startups',
    publisher: '@sama',
    publishedAt: '2026-08-24T12:00:00.000Z',
    fetchedAt: '2026-08-24T12:05:00.000Z',
    trustTier: 'primary',
    isPrimary: true,
    excerpt: 'Sam Altman expects more AI startups.',
    contentHash: 'hash',
    entities: ['Sam Altman'],
    claims: [{ id: 'claim-1', text: 'Sam Altman expects more AI startups.', kind: 'opinion', confidence: 0.9, entities: ['Sam Altman'] }],
    topics: ['ai'],
    query: null,
    metadata: { sourceAuthorHandle: 'sama', sourceAuthorName: 'Sam Altman', sourceAuthorVerified: true },
    ...overrides,
  };
}

describe('verified entity mentions', () => {
  it('links official X handles from classified network identities and source author names', () => {
    expect(xIdentityMatchesEntity('AnthropicAI', 'Anthropic')).toBe(true);
    expect(buildVerifiedEntityMentions({
      entityRoles: [{ name: 'OpenAI', role: 'company', xHandle: 'OpenAI' }],
      documents: [xDocument()],
    })).toEqual([
      { entity: 'OpenAI', handle: 'openai', role: 'company', source: 'official_x_author' },
      { entity: 'Sam Altman', handle: 'sama', role: 'other', source: 'official_x_author' },
    ]);
  });

  it('does not authorize an unrelated source author or a publisher that disagrees with the X URL', () => {
    expect(buildVerifiedEntityMentions({
      documents: [xDocument({
        canonicalUrl: 'https://x.com/reporter/status/1',
        publisher: '@reporter',
        entities: ['OpenAI'],
        claims: [],
        metadata: { sourceAuthorHandle: 'reporter', sourceAuthorName: 'Technology Reporter', sourceAuthorVerified: true },
      })],
    })).toEqual([]);

    expect(buildVerifiedEntityMentions({
      documents: [xDocument({ publisher: '@different' })],
    })).toEqual([]);

    expect(buildVerifiedEntityMentions({
      documents: [xDocument({
        canonicalUrl: 'https://x.com/notopenai/status/1',
        publisher: '@notopenai',
        entities: ['OpenAI'],
        claims: [],
        metadata: {
          sourceAuthorHandle: 'notopenai',
          sourceAuthorName: 'OpenAI',
          sourceAuthorVerified: false,
        },
      })],
    })).toEqual([]);

    expect(buildVerifiedEntityMentions({
      documents: [xDocument({
        canonicalUrl: 'https://x.com/sama/status/1',
        publisher: '@sama',
        isPrimary: false,
        metadata: {
          sourceAuthorHandle: 'sama',
          sourceAuthorName: 'Sam Altman',
          sourceAuthorVerified: true,
        },
      })],
    })).toEqual([]);
  });

  it('requires supplied handles for named entities, rejects leading handles, and records only handles in use', () => {
    const mentions = buildVerifiedEntityMentions({
      curated: [{ entity: 'OpenAI', handle: '@OpenAI', role: 'company' }],
    });

    expect(getMissingVerifiedEntityTagIssue('OpenAI will ship this faster than people expect.', mentions)).toContain('OpenAI=@openai');
    expect(getMissingVerifiedEntityTagIssue('i think @OpenAI will ship this faster than people expect.', mentions)).toBeNull();
    expect(usedVerifiedMentionHandles('i think @OpenAI will ship this faster than people expect.', mentions)).toEqual(['openai']);
    expect(isLeadingXMention('@OpenAI will ship this faster than people expect.')).toBe(true);
    expect(isLeadingXMention('i think @OpenAI will ship this faster than people expect.')).toBe(false);
  });

  it('resolves recurring companies and people from the versioned curated registry', () => {
    expect(CURATED_X_ENTITY_REGISTRY_VERSION).toBe('curated-x-entities-2026-08-26-1');
    expect(findCuratedVerifiedEntityMentions(
      'Cursor and OpenAI are compounding faster than people expect. Scott Wu sees it too.',
    )).toEqual([
      { entity: 'Cursor', handle: 'cursor_ai', role: 'company', source: 'curated_registry' },
      { entity: 'OpenAI', handle: 'openai', role: 'company', source: 'curated_registry' },
      { entity: 'Scott Wu', handle: 'scottwu46', role: 'person', source: 'curated_registry' },
    ]);
    expect(findCuratedVerifiedEntityMentions('move the cursor over the open dialog')).toEqual([]);
  });

  it('requires current curated tags and allows their handles without persisted provenance', () => {
    expect(getCuratedEntityMentionPolicyIssue(
      'Cursor at twice its last private price would still be interesting.',
    )).toContain('Cursor=@cursor_ai');
    expect(getCuratedEntityMentionPolicyIssue(
      'i would pay twice @cursor_ai’s last private price.',
    )).toBeNull();
    expect(usedCuratedVerifiedMentionHandles(
      'i would pay twice @cursor_ai’s last private price and still buy @OpenAI.',
    )).toEqual(['cursor_ai', 'openai']);
    expect(getDeprecatedCuratedEntityHandleIssue('i think @elevenlabsio can win')).toContain('@elevenlabs');
  });

  it('lets a current curated handle supersede stale source provenance', () => {
    expect(mergeVerifiedEntityMentions(
      [{ entity: 'ElevenLabs', handle: 'elevenlabsio', role: 'company', source: 'official_x_author' }],
      [{ entity: 'ElevenLabs', handle: 'elevenlabs', role: 'company', source: 'curated_registry' }],
    )).toEqual([
      { entity: 'ElevenLabs', handle: 'elevenlabs', role: 'company', source: 'curated_registry' },
    ]);
  });
});
