import { beforeEach, describe, expect, it } from 'vitest';
import { aiBudgetDay, reserveAiSpendInLedger, committedAiSpend, updateAiAttempt, type AiSpendAttempt, type AiSpendLedger } from '@/lib/ai-budget';
import { mutateAiOperationalState, getAiOperationalState } from '@/lib/kv-storage';
const day = '2026-09-07';
const context = { agentId: 'budget-test', operation: 'generation', runId: 'run', runLimitUsd: 3 };
function attempt(id: string, amount: number, runId = 'run'): AiSpendAttempt {
  return { id, runId, operation: 'generation', provider: 'openai', model: 'gpt-6-astra', day,
    reservedUsd: amount, observedUsd: null, state: 'dispatched', createdAt: '2026-09-07T20:00:00Z' };
}
describe('durable AI admission', () => {
  it('enforces run and account allowance including unresolved dispatched attempts', () => {
    const first = reserveAiSpendInLedger(null, context, attempt('1', 2), day);
    expect(() => reserveAiSpendInLedger(first, context, attempt('2', 2), day)).toThrow('budget_exhausted');
    const full = reserveAiSpendInLedger(null, {...context, runLimitUsd: 20}, attempt('1',20), day);
    expect(() => reserveAiSpendInLedger(full, {...context,runId:'other'},attempt('2',0.01,'other'),day)).toThrow('budget_exhausted');
  });
  it('settled usage frees only unused allowance, never unknown usage', () => {
    const a = attempt('1',2); expect(committedAiSpend(a)).toBe(2);
    expect(committedAiSpend({...a,state:'settled',observedUsd:0.5})).toBe(0.5);
    expect(committedAiSpend({...a,state:'released'})).toBe(0);
  });
  it('resets the daily budget at Pacific midnight including DST, but preserves a cross-midnight run limit', () => {
    expect(aiBudgetDay(new Date('2026-09-08T06:59:59Z'))).toBe('2026-09-07');
    expect(aiBudgetDay(new Date('2026-09-08T07:00:00Z'))).toBe('2026-09-08');
    expect(aiBudgetDay(new Date('2026-12-08T07:59:59Z'))).toBe('2026-12-07');
    const old = reserveAiSpendInLedger(null, context, attempt('1',2),day);
    expect(() => reserveAiSpendInLedger(old,context,{...attempt('2',2),day:'2026-09-08'},'2026-09-08')).toThrow('budget_exhausted');
    expect(reserveAiSpendInLedger(old,{...context,runId:'new'}, {...attempt('2',2,'new'),day:'2026-09-08'},'2026-09-08').attempts['2']).toBeDefined();
  });
  it('serializes competing reservations and settles the same receipt idempotently', async () => {
    const id = `budget-concurrency-${Date.now()}`;
    const reserve = (key: string) => mutateAiOperationalState<AiSpendLedger,void>(id,'spend', ledger => ({
      value:reserveAiSpendInLedger(ledger,context,attempt(key,2),day),result:undefined}));
    const result = await Promise.allSettled([reserve('a'),reserve('b')]);
    expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const ledger = (await getAiOperationalState<AiSpendLedger>(id,'spend'))!;
    const key = Object.keys(ledger.attempts)[0];
    const receipt={context:{...context,agentId:id},day,id:key};
    await updateAiAttempt(receipt,{state:'settled',observedUsd:0.5});
    await updateAiAttempt(receipt,{state:'released',observedUsd:0});
    expect((await getAiOperationalState<AiSpendLedger>(id,'spend'))!.attempts[key].observedUsd).toBe(0.5);
  });
});

it('arbitrates independent server clients through Redis revisions', async () => {
  const { mutateRemoteValue } = await import('@/lib/kv-atomic');
  let value: AiSpendLedger | null = null; let revision = 0; const receipts = new Set<string>();
  const serverClient = () => ({ eval: async (script:string, keys:string[], args:string[]) => {
    if(script.includes('cas-read')) { const snapshot=[value ? JSON.stringify(value) : false,String(revision)]; await Promise.resolve();return snapshot; }
    if(receipts.has(keys[2])) return 2;
    if(args[0]!==String(revision)) return 0;
    value=JSON.parse(args[2]); revision++; receipts.add(keys[2]);return 1;
  }});
  const servers=[serverClient(),serverClient()];
  const results=await Promise.allSettled(servers.map((client,i)=>mutateRemoteValue<AiSpendLedger,void>(client,'agent:13:ai:spend','json',ledger=>({value:reserveAiSpendInLedger(ledger,context,attempt(String(i),2),day),result:undefined}))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(Object.values(value!.attempts).reduce((n,a)=>n+committedAiSpend(a),0)).toBe(2);
});

it('reserves downstream completion capacity and enforces the evaluation campaign across days',()=>{
  expect(()=>reserveAiSpendInLedger(null,{...context,downstreamReserveUsd:1.6},attempt('idea',1.5),day)).toThrow('budget_exhausted');
  const campaign={...context,runLimitUsd:20,campaignId:'screen',campaignLimitUsd:12};
  const prior=reserveAiSpendInLedger(null,campaign,{...attempt('a',11),campaignId:'screen'},day);
  expect(()=>reserveAiSpendInLedger(prior,{...campaign,runId:'b'},{...attempt('b',2,'b'),campaignId:'screen',day:'2026-09-08'},'2026-09-08')).toThrow('budget_exhausted');
});
it('does not give a fresh allowance to unaccounted calls on the first production day',()=>{
 const ledger:AiSpendLedger={version:'account-budget-1',day,attempts:{},openingBalance:{day,unresolvedUsd:20,reason:'pre_enforcement_usage_unknown'}};
 expect(()=>reserveAiSpendInLedger(ledger,context,attempt('a',.1),day)).toThrow('budget_exhausted');
 expect(reserveAiSpendInLedger(ledger,context,{...attempt('b',.1),day:'2026-09-08'},'2026-09-08').attempts.b).toBeDefined();
});
it('protects undispatched completion capacity from competing runs',()=>{
 const ledger=reserveAiSpendInLedger(null,{...context,runLimitUsd:20,downstreamReserveUsd:2},attempt('a',17),day);
 expect(()=>reserveAiSpendInLedger(ledger,{...context,runId:'competitor'},attempt('b',2,'competitor'),day)).toThrow('budget_exhausted');
});

describe('Anti Hunter account budget isolation', () => {
  it('keeps Geoffrey at $20 and fails closed for an unconfigured Anti Hunter budget', async () => {
    const { resolveAccountDailyAiLimit } = await import('@/lib/ai-budget');
    expect(resolveAccountDailyAiLimit('geoffwoo', '5')).toBe(20);
    expect(resolveAccountDailyAiLimit('geoffreywoo', '0')).toBe(20);
    expect(resolveAccountDailyAiLimit('@AntiHunterAI', '')).toBe(0);
    expect(resolveAccountDailyAiLimit('antihunterai', '5')).toBe(5);
    expect(resolveAccountDailyAiLimit('other-account', '5')).toBeNull();
    for (const invalid of ['-1', 'Infinity', 'garbage']) {
      expect(() => resolveAccountDailyAiLimit('antihunterai', invalid)).toThrow('budget_unavailable');
    }
  });
  it('counts unresolved calls and completion holds against the smaller account cap', () => {
    const first = reserveAiSpendInLedger(null, { ...context, runLimitUsd: 10, downstreamReserveUsd: 1 }, attempt('a', 3), day, 5);
    expect(() => reserveAiSpendInLedger(first, { ...context, runId: 'b' }, attempt('b', 1.01, 'b'), day, 5)).toThrow('budget_exhausted');
    expect(() => reserveAiSpendInLedger(null, context, attempt('c', 0.01), day, 0)).toThrow('budget_exhausted');
    expect(reserveAiSpendInLedger(first, { ...context, runId: 'b' }, attempt('b', 1, 'b'), day, 5).attempts.b).toBeDefined();
  });
  it('reports the selected cap rather than Geoffrey’s allowance', async () => {
    const { summarizeAiSpend } = await import('@/lib/ai-budget');
    expect(summarizeAiSpend(null, 5)).toMatchObject({ dailyLimitUsd: 5, remainingUsd: 5 });
    expect(summarizeAiSpend(null, 0)).toMatchObject({ dailyLimitUsd: 0, remainingUsd: 0 });
  });
});


describe('publishing budget protection', () => {
  it('protects a complete run from background spend without increasing either cap', async () => {
    const { publishingBudgetReserve } = await import('@/lib/ai-budget');
    const floor = publishingBudgetReserve('geoffwoo', 'seed-synthesis', 0, 5);
    expect(floor).toBe(3);
    const prior = reserveAiSpendInLedger(null, { ...context, runLimitUsd: 20 }, attempt('spent', 16.5), day);
    expect(() => reserveAiSpendInLedger(prior, { ...context, runId: 'background' },
      attempt('background', 0.6, 'background'), day, 20, floor)).toThrow('budget_exhausted');
    // The same balance remains available to the publishing pipeline.
    expect(reserveAiSpendInLedger(prior, { ...context, runId: 'post', downstreamReserveUsd: 1.1 },
      attempt('post', 0.7, 'post'), day, 20).attempts.post).toBeDefined();
    expect(publishingBudgetReserve('geoffwoo', 'generation', 0, 5)).toBe(0);
    expect(publishingBudgetReserve('geoffwoo', 'performance', 5, 5)).toBe(0);
    expect(publishingBudgetReserve('antihunterai', 'performance', 0, 5)).toBe(0);
  });
});

it('applies the publishing floor through real account admission, not only the ledger helper', async () => {
  const { createAgent } = await import('@/lib/kv-storage');
  const { reserveAiAttempt } = await import('@/lib/ai-budget');
  const agent = await createAgent({ handle: 'geoffwoo', name: 'Budget test', soulMd: '',
    soulSummary: null, apiKey: null, apiSecret: null, accessToken: null, accessSecret: null,
    isConnected: 0, xUserId: null, setupStep: 'ready',
  });
  const today = aiBudgetDay();
  await mutateAiOperationalState<AiSpendLedger, void>(agent.id, 'spend', () => ({
    value: { version: 'account-budget-1', day: today, attempts: {
      prior: { ...attempt('prior', 17), day: today, state: 'settled', observedUsd: 17 },
    } }, result: undefined,
  }));
  const target = { provider: 'openai', model: 'gpt-6-astra' };
  await expect(reserveAiAttempt({ agentId: agent.id, operation: 'seed-synthesis', runId: 'background' },
    target, 1000, 8192)).rejects.toThrow('budget_exhausted');
  await expect(reserveAiAttempt({ agentId: agent.id, operation: 'generation', task: 'idea_generation',
    runId: 'publisher', runLimitUsd: 3, downstreamReserveUsd: 1.1 }, target, 1000, 8192)).resolves.not.toBeNull();
  const ledger = (await getAiOperationalState<AiSpendLedger>(agent.id, 'spend'))!;
  expect(Object.values(ledger.attempts).some(a => a.task === 'idea_generation')).toBe(true);
});
