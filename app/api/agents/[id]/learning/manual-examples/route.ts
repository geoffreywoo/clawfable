import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAgentAccess } from '@/lib/auth';
import { getManualExampleCuration, updateManualExampleCuration } from '@/lib/kv-storage';
import { buildLearnings } from '@/lib/performance';

function mergeIds(current: string[], add: string[] = [], remove: string[] = []): string[] {
  const next = new Set(current.map((id) => String(id)));
  for (const id of add) next.add(String(id));
  for (const id of remove) next.delete(String(id));
  return [...next];
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    return NextResponse.json(await getManualExampleCuration(id));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch manual example curation' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const body = await request.json().catch(() => ({}));
    const current = await getManualExampleCuration(id);
    const next = await updateManualExampleCuration(id, {
      pinnedXTweetIds: mergeIds(current.pinnedXTweetIds, body.pin, body.unpin),
      blockedXTweetIds: mergeIds(current.blockedXTweetIds, body.block, body.unblock),
    });
    const learnings = await buildLearnings(agent);
    return NextResponse.json({ curation: next, learnings });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to update manual example curation' }, { status: 500 });
  }
}
