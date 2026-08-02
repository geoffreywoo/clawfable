import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '@/lib/kv-storage';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, name: 'Research Agent', handle: 'research-agent', soulMd: '# Topics\n- AI startups' },
  })),
  handleAuthError: vi.fn((error: unknown) => { throw error; }),
}));

import { GET, PATCH } from '@/app/api/agents/[id]/research/agenda/route';

describe('research agenda route', () => {
  it('persists operator topics, pinned questions, blocks, and curated repositories', async () => {
    const agent = await createAgent({ handle: `research-agenda-${Date.now()}`, name: 'Research Agent', soulMd: '# Topics\n- AI startups' } as any);
    const response = await PATCH(new Request('http://localhost/api/research/agenda', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorTopics: ['AI infrastructure economics'],
        pinnedQuestions: ['Which cost curve changed this week?'],
        blockedTopics: ['partisan politics'],
        githubRepositories: ['openai/openai-python'],
      }),
    }) as any, { params: Promise.resolve({ id: agent.id }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      operatorTopics: ['AI infrastructure economics'],
      pinnedQuestions: ['Which cost curve changed this week?'],
      blockedTopics: ['partisan politics'],
      githubRepositories: ['openai/openai-python'],
    });
    expect(data.queries).toEqual(expect.arrayContaining(['AI infrastructure economics', 'Which cost curve changed this week?']));

    const loaded = await GET(new Request('http://localhost/api/research/agenda') as any, {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(await loaded.json()).toMatchObject({ operatorTopics: ['AI infrastructure economics'] });
  });

  it('rejects private-network feed URLs before they reach the async fetcher', async () => {
    const agent = await createAgent({ handle: `research-agenda-private-${Date.now()}`, name: 'Research Agent', soulMd: '# soul' } as any);
    const response = await PATCH(new Request('http://localhost/api/research/agenda', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rssFeeds: [{ id: 'private', url: 'https://127.0.0.1/feed', publisher: 'Private', topics: ['AI'] }],
      }),
    }) as any, { params: Promise.resolve({ id: agent.id }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/private network/i);
  });
});
