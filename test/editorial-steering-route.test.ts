import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ access: vi.fn(), ideas: vi.fn(), drafts: vi.fn(), get: vi.fn(), existing: vi.fn(), save: vi.fn(), revoke: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAgentAccess: mocks.access, handleAuthError: (error: Error) => {
  if (error.message === 'unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  throw error;
} }));
vi.mock('@/lib/kv-storage', () => ({ getIdeaCandidates: mocks.ideas, getDraftCandidates: mocks.drafts }));
vi.mock('@/lib/editorial-steering', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/editorial-steering')>(),
  getEditorialSteering: mocks.get, getEditorialSteeringRequest: mocks.existing, saveEditorialSteering: mocks.save, revokeEditorialSteering: mocks.revoke,
}));
import { GET, POST, DELETE } from '@/app/api/agents/[id]/editorial-steering/route';
import { EditorialSteeringError } from '@/lib/editorial-steering';

const params = { params: Promise.resolve({ id: '13' }) };
const request = (body: unknown, method = 'POST') => new NextRequest('https://example.com/api/agents/13/editorial-steering', {
  method, headers: { 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});
const valid = { requestId: 'owner-request', kind: 'take', instruction: 'Start with who would buy this.', scope: 'one_off' };

describe('authenticated editorial steering API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ user: { id: 'authenticated-owner' }, agent: { id: '13' } });
    mocks.ideas.mockResolvedValue([{ id: 'idea-a', agentId: '13' }]);
    mocks.drafts.mockResolvedValue([{ id: 'draft-a', agentId: '13', ideaId: 'idea-a' }]);
    mocks.save.mockResolvedValue({ id: 'steering-a', status: 'pending' });
    mocks.existing.mockResolvedValue(null);
    mocks.get.mockResolvedValue([{ id: 'steering-a', status: 'claimed', jobId: 'job-a' }]);
    mocks.revoke.mockResolvedValue({ id: 'steering-a', status: 'revoked' });
  });
  it('authenticates reads, creates and revocations before touching storage', async () => {
    mocks.access.mockRejectedValue(new Error('unauthorized'));
    expect((await GET(request(null, 'GET'), params)).status).toBe(401);
    expect((await POST(request(valid), params)).status).toBe(401);
    expect((await DELETE(request({ id: 'steering-a', requestId: 'revoke' }, 'DELETE'), params)).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('uses authenticated owner identity and returns record IDs and status', async () => {
    const response = await POST(request({ ...valid, ideaId: 'idea-a', draftId: 'draft-a' }), params);
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('13', 'authenticated-owner', { ...valid, ideaId: 'idea-a', draftId: 'draft-a' });
    expect(await response.json()).toEqual({ record: { id: 'steering-a', status: 'pending' } });
    expect(await (await GET(request(null, 'GET'), params)).json()).toEqual({ records: [{ id: 'steering-a', status: 'claimed', jobId: 'job-a' }] });
  });
  it.each([{ ownerUserId: 'other' }, { provenance: 'explicit_authenticated_owner' }, { inferred: true }, { autopilotEnabled: false }, { kind: ['topic'], scope: ['one_off'] }])('rejects caller identity and automation overrides %j', extra => {
    return POST(request({ ...valid, ...extra }), params).then(response => {
      expect(response.status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
    });
  });
  it('rejects another account’s idea, draft, and mismatched lineage', async () => {
    mocks.ideas.mockResolvedValue([{ id: 'idea-a', agentId: '14' }]);
    expect((await POST(request({ ...valid, ideaId: 'idea-a' }), params)).status).toBe(404);
    mocks.drafts.mockResolvedValue([{ id: 'draft-a', agentId: '14', ideaId: 'idea-a' }]);
    expect((await POST(request({ ...valid, draftId: 'draft-a' }), params)).status).toBe(404);
    mocks.ideas.mockResolvedValue([{ id: 'idea-a', agentId: '13' }]);
    mocks.drafts.mockResolvedValue([{ id: 'draft-a', agentId: '13', ideaId: 'another-idea' }]);
    expect((await POST(request({ ...valid, ideaId: 'idea-a', draftId: 'draft-a' }), params)).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('returns conflict for changed idempotency reuse and redacts unexpected storage failures', async () => {
    mocks.save.mockRejectedValueOnce(new EditorialSteeringError('requestId already used', 409));
    expect((await POST(request(valid), params)).status).toBe(409);
    mocks.save.mockRejectedValueOnce(new Error('private storage detail'));
    const response = await POST(request(valid), params);
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('private');
  });
  it('replays a saved request after referenced candidates are pruned, but rejects conflicting reuse', async () => {
    mocks.ideas.mockResolvedValue([]); mocks.drafts.mockResolvedValue([]);
    const saved = { id: 'steering-old', status: 'consumed', ideaId: 'idea-pruned', draftId: 'draft-pruned' };
    mocks.existing.mockResolvedValueOnce(saved);
    const response = await POST(request({ ...valid, ideaId: 'idea-pruned', draftId: 'draft-pruned' }), params);
    expect(await response.json()).toEqual({ record: saved });
    expect(mocks.ideas).not.toHaveBeenCalled(); expect(mocks.drafts).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    mocks.existing.mockRejectedValueOnce(new EditorialSteeringError('requestId was already used for different steering', 409));
    expect((await POST(request({ ...valid, instruction: 'Changed instruction' }), params)).status).toBe(409);
  });
  it('revokes explicitly without allowing client lifecycle events', async () => {
    expect((await DELETE(request({ id: 'steering-a', requestId: 'revoke' }, 'DELETE'), params)).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith('13', 'authenticated-owner', 'steering-a', 'revoke');
    expect((await DELETE(request({ id: 'steering-a', requestId: 'revoke', status: 'consumed' }, 'DELETE'), params)).status).toBe(400);
  });
});
