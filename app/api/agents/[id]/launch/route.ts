import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAgentAccess } from '@/lib/auth';
import { launchAgentFromPreview, SetupLaunchError } from '@/lib/setup-launch';

// POST /api/agents/[id]/launch
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const result = await launchAgentFromPreview({
      agentId: id,
      reviewedTweetIds: Array.isArray(body.reviewedTweetIds) ? body.reviewedTweetIds : [],
      approvedTweetIds: Array.isArray(body.approvedTweetIds) ? body.approvedTweetIds : [],
      postsPerDay: body.postsPerDay,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    if (err instanceof SetupLaunchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Launch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
