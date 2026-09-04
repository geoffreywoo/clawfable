import { describe, expect, it, vi } from 'vitest';
import { mutateRemoteValue } from '@/lib/kv-atomic';

describe('atomic Redis hash scalar decoding', () => {
  it.each([
    ['1777777777777777777', '1777777777777777777'],
    ['9007199254740993', '9007199254740993'],
    ['9007199254740992', '9007199254740992'],
    // The SDK can eagerly decode an exactly representable unsafe integer.
    [9007199254740992, '9007199254740992'],
  ])('preserves unsafe integer identity %s without changing ordinary scalar types', async (rawId, expectedId) => {
    let committed: Record<string, string> | undefined;
    const client = { eval: vi.fn(async (script: string, _keys: string[], args: string[]) => {
      if (script.includes('cas-read')) return [[
        'id', rawId, 'amount', '4900', 'reward', '0.625', 'approved', 'true', 'missing', 'null',
        'metadata', '{"xUserId":"1777777777777777777"}',
      ], '0'];
      committed = JSON.parse(args[2]);
      return 1;
    }) };
    const result = await mutateRemoteValue<Record<string, unknown>, Record<string, unknown>>(
      client, `user:${expectedId}`, 'hash', (current) => ({ value: current!, result: current! }),
    );
    expect(result).toEqual({ id: expectedId, amount: 4900, reward: 0.625, approved: true,
      missing: null, metadata: { xUserId: '1777777777777777777' } });
    expect(committed?.id).toBe(expectedId);
    expect(committed?.reward).toBe('0.625');
  });

  it('accepts already-decoded EVAL scalars and objects without reparsing or coercing them', async () => {
    const expected = { id: '1777777777777777777', amount: 4900, reward: 0.625, approved: true,
      missing: null, metadata: { xUserId: '1777777777777777777' } };
    const client = { eval: vi.fn(async (script: string) => script.includes('cas-read')
      ? [Object.entries(expected).flat(), '0'] : 1) };
    const result = await mutateRemoteValue<Record<string, unknown>, Record<string, unknown>>(
      client, `user:${expected.id}`, 'hash', (current) => ({ value: current!, result: current! }),
    );
    expect(result).toEqual(expected);
  });
});
