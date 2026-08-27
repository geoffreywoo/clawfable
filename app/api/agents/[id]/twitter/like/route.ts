import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/twitter/like
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    return NextResponse.json({
      error: 'X API liking is disabled because the like endpoint is blocked for this app. Use supervised browser-companion likes instead.',
      code: 'x_like_api_disabled',
    }, { status: 410 });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to validate like request' }, { status: 500 });
  }
}
