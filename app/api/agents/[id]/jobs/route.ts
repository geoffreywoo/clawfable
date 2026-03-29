import { NextRequest, NextResponse } from 'next/server';
import { getJobs, createJob } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/jobs
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const jobs = await getJobs(id);
    return NextResponse.json(jobs);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

// POST /api/agents/[id]/jobs
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const body = await request.json();

    const { name, description, schedule, postsPerRun, topics, formats, source } = body;
    if (!name || !schedule) {
      return NextResponse.json({ error: 'name and schedule are required' }, { status: 400 });
    }

    const job = await createJob({
      agentId: id,
      name,
      description: description || '',
      schedule,
      postsPerRun: Math.min(Math.max(postsPerRun || 1, 1), 5),
      topics: topics || [],
      formats: formats || [],
      enabled: true,
      source: source || 'user',
    });

    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to create job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
