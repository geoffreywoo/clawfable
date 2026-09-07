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
