import { afterEach, describe, expect, it, vi } from 'vitest';

describe('kv-storage user index repair', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('backfills the users set from existing user hashes when the index is empty', async () => {
    const fakeKv = {
      smembers: vi.fn(async (key: string) => {
        if (key === 'users') return [];
        return [];
      }),
      scan: vi.fn(async () => [
        '0',
        [
          'user:161427827',
          'user:161427827:agents',
          'user:2019634783962226688',
          'user:2019634783962226688:agents',
        ],
      ]),
      hgetall: vi.fn(async (key: string) => {
        if (key === 'user:161427827') {
          return {
            id: '161427827',
            username: 'geoffreywoo',
            name: 'Geoffrey Woo',
            plan: 'free',
            billingStatus: 'free',
            createdAt: '2026-04-08T00:00:00.000Z',
          };
        }
        if (key === 'user:2019634783962226688') {
          return {
            id: '2019634783962226688',
            username: 'antihunterai',
            name: 'AntihunterAI',
            plan: 'free',
            billingStatus: 'free',
            createdAt: '2026-04-08T00:00:01.000Z',
          };
        }
        return null;
      }),
      sadd: vi.fn(async () => 2),
    };

    vi.stubEnv('KV_URL', 'redis://example');
    vi.stubEnv('KV_REST_API_URL', 'https://example.vercel-storage.com');
    vi.doMock('@vercel/kv', () => ({ kv: fakeKv }));

    const { getUsers } = await import('@/lib/kv-storage');
    const users = await getUsers();

    expect(users.map((user) => user.username)).toEqual(['geoffreywoo', 'antihunterai']);
    expect(fakeKv.scan).toHaveBeenCalledWith('0', { match: 'user:*', count: 200 });
    expect(fakeKv.sadd).toHaveBeenCalledWith('users', '161427827', '2019634783962226688');
  });

  it('backfills username lookup keys for legacy users on first username lookup', async () => {
    const fakeKv = {
      get: vi.fn(async (key: string) => {
        if (key === 'user:username:geoffreywoo') return null;
        return null;
      }),
      smembers: vi.fn(async (key: string) => {
        if (key === 'users') return ['161427827'];
        return [];
      }),
      hgetall: vi.fn(async (key: string) => {
        if (key === 'user:161427827') {
          return {
            id: '161427827',
            username: 'geoffreywoo',
            name: 'Geoffrey Woo',
            plan: 'free',
            billingStatus: 'free',
            createdAt: '2026-04-08T00:00:00.000Z',
          };
        }
        return null;
      }),
      set: vi.fn(async () => 'OK'),
    };

    vi.stubEnv('KV_URL', 'redis://example');
    vi.stubEnv('KV_REST_API_URL', 'https://example.vercel-storage.com');
    vi.doMock('@vercel/kv', () => ({ kv: fakeKv }));

    const { getUserByUsername } = await import('@/lib/kv-storage');
    const user = await getUserByUsername('geoffreywoo');

    expect(user?.id).toBe('161427827');
    expect(fakeKv.set).toHaveBeenCalledWith('user:username:geoffreywoo', '161427827');
  });
});
