import { NextRequest, NextResponse } from 'next/server';
import { TRENDING_TOPICS } from '@/lib/tweet-templates';

// GET /api/agents/[id]/topics
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params; // consume params
  return NextResponse.json(TRENDING_TOPICS);
}
