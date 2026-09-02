import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { resolveEngagementTarget } from '@/lib/engagement';
import { readJsonObjectBody } from '@/lib/request-validation';

// POST /api/agents/[id]/engage/resolve-target
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { agent } = await requireAgentAccess(id);
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
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
