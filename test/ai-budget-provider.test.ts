import { afterEach, expect, it, vi } from 'vitest';
const reservation = { id:'attempt',day:'2026-09-07',context:{agentId:'13',operation:'generation',runId:'r'} };
const reserve=vi.fn(), update=vi.fn(), create=vi.fn();
async function setup() {
  vi.resetModules(); vi.stubEnv('OPENAI_API_KEY','test-key'); vi.stubEnv('ANTHROPIC_API_KEY',''); vi.stubEnv('AI_BUDGET_TEST_ENFORCE','true');
  vi.doMock('@/lib/ai-budget',async()=>({...await vi.importActual<any>('@/lib/ai-budget'),reserveAiAttempt:reserve,updateAiAttempt:update}));
  vi.doMock('openai',()=>({default:class {responses={create};}}));
  reserve.mockResolvedValue(reservation);update.mockResolvedValue(undefined);
  return (await import('@/lib/ai')).generateText;
}
const options={system:'Write',prompt:'Copy',maxTokens:100,spendContext:reservation.context,
  modelChain:[{provider:'openai' as const,model:'gpt-5.6'},{provider:'openai' as const,model:'gpt-5.5'},{provider:'openai' as const,model:'gpt-5.6-sol'}]};
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.resetAllMocks();vi.doUnmock('openai');vi.doUnmock('@/lib/ai-budget');});
it('charges both attempts and retains unknown usage from a failed dispatch',async()=>{
 const generate=await setup();create.mockRejectedValueOnce(new Error('transport interrupted')).mockResolvedValueOnce({status:'completed',output_text:'Ready',usage:{input_tokens:100,output_tokens:20}});
 await generate(options);expect(reserve).toHaveBeenCalledTimes(2);
 expect(update.mock.calls.some(([,patch])=>patch.state==='released')).toBe(false);
 expect(update.mock.calls.some(([,patch])=>patch.state==='settled'&&patch.observedUsd>0)).toBe(true);
});
it('never dispatches when pricing or durable admission is unavailable',async()=>{
 const generate=await setup();const {AiBudgetError}=await import('@/lib/ai-budget');reserve.mockRejectedValue(new AiBudgetError('budget_unavailable'));
 await expect(generate(options)).rejects.toThrow('budget_unavailable');expect(create).not.toHaveBeenCalled();
});
it('allows at most one provider fallback for the budget account',async()=>{
 const generate=await setup();create.mockRejectedValue(new Error('transport interrupted'));
 await expect(generate(options)).rejects.toThrow();expect(create).toHaveBeenCalledTimes(2);expect(reserve).toHaveBeenCalledTimes(2);
});
it('releases only an attempt proven undispatched when storage consumed its deadline',async()=>{
 const generate=await setup();vi.useFakeTimers();reserve.mockImplementation(async()=>{vi.setSystemTime(Date.now()+1000);return reservation;});
 await expect(generate({...options,timeoutMs:100})).rejects.toThrow('deadline');expect(create).not.toHaveBeenCalled();
 expect(update).toHaveBeenCalledWith(reservation,expect.objectContaining({state:'released',reason:'not_dispatched_deadline'}));
});
it('keeps a dispatched unknown-usage response reserved',async()=>{
 const generate=await setup();create.mockResolvedValue({status:'completed',output_text:'Ready'});
 await generate(options);expect(update).toHaveBeenLastCalledWith(reservation,expect.objectContaining({state:'dispatched',observedUsd:null}));
});
it('rejects missing attribution before a provider attempt',async()=>{
 const generate=await setup();await expect(generate({...options,spendContext:undefined})).rejects.toThrow('attribution_missing');expect(create).not.toHaveBeenCalled();
});
