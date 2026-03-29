import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/analysis — get stored analysis
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'No analysis found. Run analysis first.' }, { status: 404 });
    }

    return NextResponse.json(analysis);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch analysis' }, { status: 500 });
  }
}
