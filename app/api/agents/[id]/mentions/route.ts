import { NextRequest, NextResponse } from 'next/server';
import { getMentions } from '@/lib/kv-storage';

// GET /api/agents/[id]/mentions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const mentions = await getMentions(id);
    return NextResponse.json(mentions);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch mentions' }, { status: 500 });
  }
}
