import { createHash, randomUUID } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import { AiBudgetError } from './ai-budget';
interface CachedValue<T> { digest: string; value?: T; owner?: string; leaseUntil?: number; }
/** A content/version cache, not a time-based permission to repeat a paid call. */
export async function cachedAiValue<T>(agentId: string | undefined, operation: string, material: unknown, compute: () => Promise<T>): Promise<T> {
  if (!agentId || (process.env.NODE_ENV === 'test' && process.env.AI_BUDGET_TEST_ENFORCE !== 'true')) return compute();
  const digest = createHash('sha256').update(JSON.stringify({ modelPolicy: process.env.AI_MODEL_POLICY || 'legacy_task_chains', material })).digest('hex');
  const namespace = `cache:${operation}:${digest}`;
  const owner = randomUUID();
  const claimed = await mutateAiOperationalState<CachedValue<T>, CachedValue<T>>(agentId, namespace, current => {
    if (current && 'value' in current) return { value: current, result: current, skip: true };
    if ((current?.leaseUntil || 0) > Date.now()) throw new AiBudgetError('budget_unavailable');
    const next = { digest, owner, leaseUntil: Date.now() + 300000 };
    return { value: next, result: next };
  });
  if ('value' in claimed) return claimed.value!;
  try {
    const value = await compute();
    await mutateAiOperationalState<CachedValue<T>, void>(agentId, namespace, current => current?.owner === owner
      ? { value: { digest, value }, result: undefined } : { value: current!, result: undefined, skip: true });
    return value;
  } catch (error) {
    // The billing reservation is separate; releasing a cache lease never refunds provider usage.
    await mutateAiOperationalState<CachedValue<T>, void>(agentId, namespace, current => current?.owner === owner
      ? { value: { digest }, result: undefined } : { value: current!, result: undefined, skip: true });
    throw error;
  }
}
