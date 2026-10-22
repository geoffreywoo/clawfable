import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAgentAccess: mocks.access, handleAuthError: (error: Error) => {
  if (error.message === 'unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  throw error;
} }));
vi.mock('@/lib/editorial-learning-status', () => ({ getEditorialLearningStatus: mocks.read,
  EditorialLearningStatusError: class EditorialLearningStatusError extends Error { constructor(message: string, readonly status = 400) { super(message); } } }));
import { GET } from '@/app/api/agents/[id]/editorial-learning/route';
import { EditorialLearningStatusError } from '@/lib/editorial-learning-status';

const params = { params: Promise.resolve({ id: 'account-b' }) };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'owner' } }); mocks.read.mockResolvedValue({ agentId: 'account-b', jobs: [] }); });

it('authenticates before any account read', async () => {
  mocks.access.mockRejectedValue(new Error('unauthorized'));
  expect((await GET(new NextRequest('https://example.com/api/agents/account-b/editorial-learning'), params)).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});

it('uses the authenticated route account and only allows the job selection option', async () => {
  const response = await GET(new NextRequest('https://example.com/api/agents/account-b/editorial-learning?jobId=generation-job-old&agentId=other&force=true'), params);
  expect(mocks.access).toHaveBeenCalledWith('account-b');
  expect(mocks.read).toHaveBeenCalledWith('account-b', { jobId: 'generation-job-old' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ agentId: 'account-b', jobs: [] });
});

it('returns safe validation/not-found errors and redacts unexpected failures', async () => {
  const request = new NextRequest('https://example.com/api/agents/account-b/editorial-learning');
  mocks.read.mockRejectedValueOnce(new EditorialLearningStatusError('Job not found', 404));
  expect((await GET(request, params)).status).toBe(404);
  mocks.read.mockRejectedValueOnce(new Error('secret storage configuration'));
  const response = await GET(request, params);
  expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'Unable to read editorial learning' });
});
