import { NextRequest, NextResponse } from 'next/server';
import { getMetricsArray } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/metrics
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const metrics = await getMetricsArray(id);
    return NextResponse.json(metrics);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
