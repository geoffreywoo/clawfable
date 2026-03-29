import { NextRequest, NextResponse } from 'next/server';
import { getAgent, getAnalysis } from '@/lib/kv-storage';

// GET /api/agents/[id]/analysis — get stored analysis
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'No analysis found. Run analysis first.' }, { status: 404 });
    }

    return NextResponse.json(analysis);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch analysis' }, { status: 500 });
  }
}
