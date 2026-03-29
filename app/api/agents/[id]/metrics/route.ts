import { NextRequest, NextResponse } from 'next/server';
import { getMetricsArray } from '@/lib/kv-storage';

// GET /api/agents/[id]/metrics
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const metrics = await getMetricsArray(id);
    return NextResponse.json(metrics);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
