import { describe, expect, it } from 'vitest';
import { getAiOperationalState, getLearningSignals, getVoiceDirectiveRules } from '@/lib/kv-storage';
import {
  claimEditorialSteeringForJob, completeEditorialSteeringJob, getEditorialSteering,
  MAX_EDITORIAL_STEERING_RECORDS, parseEditorialSteeringInput, revokeEditorialSteering,
  saveEditorialSteering, type EditorialSteeringInput, type EditorialSteeringLedger,
} from '@/lib/editorial-steering';

const now = Date.parse('2026-10-03T08:00:00Z');
const input = (requestId: string, extra: Partial<EditorialSteeringInput> = {}): EditorialSteeringInput => ({
  requestId, kind: 'take', instruction: 'Start with the practical consequence for the buyer.', scope: 'one_off', ...extra,
});
const ledger = (id: string) => getAiOperationalState<EditorialSteeringLedger>(id, 'editorial-steering');

describe('explicit owner editorial steering', () => {
  it('deduplicates concurrent owner submissions and rejects changed reuse of a request ID', async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => saveEditorialSteering('steering-dedupe', 'owner', input('request-1'), now)));
    expect(new Set(rows.map(row => row.id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ ownerUserId: 'owner', provenance: 'explicit_authenticated_owner', status: 'pending',
      expiresAt: '2026-10-10T08:00:00.000Z' });
    expect((await ledger('steering-dedupe'))?.events).toHaveLength(1);
    await expect(saveEditorialSteering('steering-dedupe', 'owner', input('request-1', { instruction: 'Different instruction' }), now))
      .rejects.toMatchObject({ status: 409 });
    await expect(saveEditorialSteering('steering-dedupe', 'different-owner', input('request-1'), now)).rejects.toMatchObject({ status: 409 });
  });

  it('binds a one-off to only one concurrent job and replays its frozen guidance across interruptions', async () => {
    const agent = 'steering-concurrent';
    const standing = await saveEditorialSteering(agent, 'owner', input('standing', { scope: 'standing', kind: 'copy' }), now);
    const once = await saveEditorialSteering(agent, 'owner', input('once', { topic: 'Hardware', ideaId: 'idea-reference', draftId: 'draft-reference' }), now + 1);
    const [a, b] = await Promise.all([
      claimEditorialSteeringForJob(agent, 'job-a', now + 2), claimEditorialSteeringForJob(agent, 'job-b', now + 2),
    ]);
    expect([...a, ...b].filter(row => row.id === once.id)).toHaveLength(1);
    expect([...a, ...b].filter(row => row.id === standing.id)).toHaveLength(2);
    const jobId = a.some(row => row.id === once.id) ? 'job-a' : 'job-b';
    const frozen = jobId === 'job-a' ? a : b;
    await saveEditorialSteering(agent, 'owner', input('new-coaching', { scope: 'standing', instruction: 'New instruction' }), now + 3);
    await revokeEditorialSteering(agent, 'owner', standing.id, 'revoke-standing', now + 4);
    expect(await claimEditorialSteeringForJob(agent, jobId, now + 5)).toEqual(frozen);
    expect((await getEditorialSteering(agent, now + 5)).find(row => row.id === once.id)).toMatchObject({ status: 'claimed', jobId });
    // A deferred provider call does not complete the job. Completion is explicit and idempotent.
    await completeEditorialSteeringJob(agent, jobId, now + 6);
    await completeEditorialSteeringJob(agent, jobId, now + 7);
    expect((await getEditorialSteering(agent, now + 8)).find(row => row.id === once.id)?.status).toBe('consumed');
    expect((await claimEditorialSteeringForJob(agent, 'job-c', now + 8)).map(row => row.id)).not.toContain(once.id);
    expect((await ledger(agent))?.events.filter(event => event.type === 'consumed')).toHaveLength(1);
  });

  it('expires temporary guidance and preserves revoked records and exact retry readback', async () => {
    const agent = 'steering-expiry';
    const original = input('temporary', { scope: 'standing', expiresAt: new Date(now + 1000).toISOString() });
    const saved = await saveEditorialSteering(agent, 'owner', original, now);
    expect(await claimEditorialSteeringForJob(agent, 'later', now + 1001)).toEqual([]);
    expect(await saveEditorialSteering(agent, 'owner', original, now + 2000)).toMatchObject({ id: saved.id, status: 'expired' });
    await revokeEditorialSteering(agent, 'owner', saved.id, 'revoke', now + 2001);
    await revokeEditorialSteering(agent, 'owner', saved.id, 'revoke', now + 2002);
    await revokeEditorialSteering(agent, 'owner', saved.id, 'repeated-revoke', now + 2003);
    const state = await ledger(agent);
    expect(state?.records).toHaveLength(1);
    expect(state?.records[0].instruction).toBe(original.instruction);
    expect(state?.events.map(event => event.type)).toEqual(['created', 'revoked']);
    expect((await getEditorialSteering(agent, now + 2004))[0].status).toBe('revoked');
  });

  it('bounds prompt guidance and leaves overflow one-offs pending for future jobs', async () => {
    const agent = 'steering-bounded';
    for (let i = 0; i < 6; i++) await saveEditorialSteering(agent, 'owner', input(`once-${i}`, { instruction: 'x'.repeat(900) }), now + i);
    const claimed = await claimEditorialSteeringForJob(agent, 'first', now + 10);
    expect(claimed).toHaveLength(3);
    await completeEditorialSteeringJob(agent, 'first', now + 11);
    expect((await getEditorialSteering(agent, now + 12)).filter(row => row.status === 'pending')).toHaveLength(3);
    expect(await claimEditorialSteeringForJob(agent, 'second', now + 12)).toHaveLength(3);
    expect(await claimEditorialSteeringForJob('other-account', 'third', now + 12)).toEqual([]);
    expect(await getLearningSignals(agent)).toEqual([]);
    expect(await getVoiceDirectiveRules(agent)).toEqual([]);
  });

  it('preserves the entire bounded audit instead of silently pruning old records', async () => {
    const agent = 'steering-capacity';
    for (let i = 0; i < MAX_EDITORIAL_STEERING_RECORDS; i++) await saveEditorialSteering(agent, 'owner', input(`request-${i}`), now);
    const before = await ledger(agent);
    await expect(saveEditorialSteering(agent, 'owner', input('overflow'), now)).rejects.toMatchObject({ status: 409 });
    expect(await ledger(agent)).toEqual(before);
    expect(await claimEditorialSteeringForJob(agent, 'continues', now + 1)).toHaveLength(4);
  });

  it.each([
    { ownerUserId: 'forged' }, { inferred: true }, { kind: 'ban' }, { kind: ['topic'] },
    { scope: 'permanent_block' }, { scope: ['standing'] }, { instruction: ' ' },
    { expiresAt: 'invalid' }, { expiresAt: new Date(now - 1).toISOString() }, { autopilotEnabled: false },
  ])('rejects invalid or non-explicit input %j', extra => {
    expect(() => parseEditorialSteeringInput({ ...input('invalid'), ...extra }, now)).toThrow();
  });
});
