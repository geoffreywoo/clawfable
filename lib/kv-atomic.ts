import { randomUUID } from 'node:crypto';

/** Atomic optimistic updates shared by independent Vercel instances. */
export const READ_CAS_SNAPSHOT_SCRIPT = `-- clawfable:cas-read:v1
local value
if ARGV[1] == 'hash' then
  value = redis.call('HGETALL', KEYS[1])
else
  value = redis.call('GET', KEYS[1]) or false
end
return {value, redis.call('GET', KEYS[2]) or '0'}
`;

export const COMMIT_CAS_SCRIPT = `-- clawfable:cas-commit:v1
if redis.call('EXISTS', KEYS[3]) == 1 then return 2 end
if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end
if ARGV[2] == 'hash' then
  local fields = cjson.decode(ARGV[3])
  for field, value in pairs(fields) do
    redis.call('HSET', KEYS[1], field, value)
  end
else
  redis.call('SET', KEYS[1], ARGV[3])
end
redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[3], '1', 'EX', 3600)
return 1
`;

type CasClient = {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

export type CasMutation<T, R> = { value: T; result: R; skip?: boolean };

function decodeSnapshot<T>(raw: unknown, kind: 'json' | 'hash'): T | null {
  if (kind === 'hash') {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const value: Record<string, unknown> = {};
    for (let index = 0; index < raw.length; index += 2) {
      let fieldValue = raw[index + 1];
      if (typeof fieldValue === 'string') {
        try { fieldValue = JSON.parse(fieldValue); } catch { /* Plain Redis string. */ }
      }
      value[String(raw[index])] = fieldValue;
    }
    return value as T;
  }
  if (raw === null || raw === undefined || raw === false) return null;
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}

/**
 * The updater must be pure. Lost commit responses retry the same receipt-bound
 * operation; conflicts reload authoritative state, never a process read cache.
 * Revisions are additive; existing JSON arrays/hashes need no data migration.
 */
export async function mutateRemoteValue<T, R>(
  client: CasClient,
  key: string,
  kind: 'json' | 'hash',
  update: (current: T | null) => CasMutation<T, R>,
): Promise<R> {
  const keys = [key, `${key}:cas_revision`, `${key}:cas_receipt:${randomUUID()}`];
  let pending: { mutation: CasMutation<T, R>; args: string[] } | null = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!pending) {
      const snapshot = await client.eval(READ_CAS_SNAPSHOT_SCRIPT, keys, [kind]) as [unknown, unknown];
      const mutation = update(decodeSnapshot<T>(snapshot[0], kind));
      if (mutation.skip) return mutation.result;
      const serialized = kind === 'hash'
        ? JSON.stringify(Object.fromEntries(Object.entries(mutation.value as Record<string, unknown>).map(([field, value]) => [
            field, typeof value === 'string' ? value : JSON.stringify(value ?? null),
          ])))
        : JSON.stringify(mutation.value);
      pending = { mutation, args: [String(snapshot[1]), kind, serialized] };
    }
    try {
      const committed = Number(await client.eval(COMMIT_CAS_SCRIPT, keys, pending.args));
      if (committed === 1 || committed === 2) return pending.mutation.result;
      pending = null;
    } catch (error) {
      if (attempt === 15) throw error;
      // Retry the identical operation. Its receipt survives another writer's
      // later commit, so a lost response cannot replay an obsolete transition.
    }
  }
  throw new Error(`Concurrent storage update did not settle for ${key}`);
}
