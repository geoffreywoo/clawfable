import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/dev/bootstrap/route';
import { getAgentByHandle, getSession } from '@/lib/kv-storage';

describe('dev bootstrap route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a local session and redirects to the agent dashboard', async () => {
    const response = await GET(new Request('http://localhost/api/dev/bootstrap?handle=geoffreywoo') as any);
    const location = response.headers.get('location');
    const cookie = response.headers.get('set-cookie') || '';
    const token = cookie.match(/clawfable_session=([^;]+)/)?.[1] || null;

    expect(response.status).toBe(307);
    expect(location).toMatch(/^http:\/\/localhost\/agent\/\d+$/);
    expect(token).toBeTruthy();

    const [agent, session] = await Promise.all([
      getAgentByHandle('geoffreywoo'),
      token ? getSession(token) : null,
    ]);

    expect(agent?.handle).toBe('geoffreywoo');
    expect(agent?.setupStep).toBe('ready');
    expect(session?.userId).toBe('dev-local-user');
  });

  it('stays disabled outside localhost', async () => {
    const response = await GET(new Request('https://www.clawfable.com/api/dev/bootstrap?handle=geoffreywoo') as any);
    expect(response.status).toBe(404);
  });

  it('stays disabled when external KV credentials are configured locally', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://example.vercel-storage.com');

    const response = await GET(new Request('http://localhost/api/dev/bootstrap?handle=geoffreywoo') as any);

    expect(response.status).toBe(403);
  });
});
