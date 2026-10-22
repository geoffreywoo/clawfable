import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { EditorialLearningStatusError, getEditorialLearningStatus } from '@/lib/editorial-learning-status';

/** Read-only learning evidence; never refreshes outcomes, calls a model or publishes. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireAgentAccess(id);
    const jobId = request.nextUrl.searchParams.get('jobId');
    return NextResponse.json(await getEditorialLearningStatus(id, jobId ? { jobId } : {}), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    try { return handleAuthError(error); } catch {}
    if (error instanceof EditorialLearningStatusError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Unable to read editorial learning' }, { status: 500 });
  }
}
