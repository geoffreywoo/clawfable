import { NextRequest, NextResponse } from 'next/server';
import { getJob, updateJob, deleteJob } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// PATCH /api/agents/[id]/jobs/[jobId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const { id, jobId } = await params;
  try {
    await requireAgentAccess(id);
    const job = await getJob(jobId);
    if (!job || job.agentId !== id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const body = await request.json();
    const allowed = ['name', 'description', 'schedule', 'postsPerRun', 'topics', 'formats', 'enabled'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (updates.postsPerRun !== undefined) {
      updates.postsPerRun = Math.min(Math.max(Number(updates.postsPerRun), 1), 5);
    }

    const updated = await updateJob(jobId, updates);
    return NextResponse.json(updated);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to update job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/agents/[id]/jobs/[jobId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const { id, jobId } = await params;
  try {
    await requireAgentAccess(id);
    const job = await getJob(jobId);
    if (!job || job.agentId !== id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    await deleteJob(jobId);
    return NextResponse.json({ success: true });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
