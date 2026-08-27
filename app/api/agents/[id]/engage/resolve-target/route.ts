import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { resolveEngagementTarget } from '@/lib/engagement';

// POST /api/agents/[id]/engage/resolve-target
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { agent } = await requireAgentAccess(id);
    const body = await request.json();
    const url = typeof body?.url === 'string' ? body.url : '';

    if (!url.trim()) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const candidate = await resolveEngagementTarget(agent, url);
    return NextResponse.json(candidate);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to resolve target';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
