import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAgentAccess } from '@/lib/auth';
import { getManualExampleCuration, updateManualExampleCuration } from '@/lib/kv-storage';
import { buildLearnings } from '@/lib/performance';
import { readJsonObjectBody } from '@/lib/request-validation';

function mergeIds(current: string[], add: string[] = [], remove: string[] = []): string[] {
  const next = new Set(current.map((id) => String(id)));
  for (const id of add) next.add(String(id));
  for (const id of remove) next.delete(String(id));
  return [...next];
}

function requestIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((id) => String(id)).filter(Boolean))]
    : [];
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
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
    const current = await getManualExampleCuration(id);
    const pin = requestIds(body.pin);
    const block = requestIds(body.block);
    const blockedByRequest = new Set(block);
    const pinnedXTweetIds = mergeIds(current.pinnedXTweetIds, pin, requestIds(body.unpin))
      .filter((tweetId) => !blockedByRequest.has(tweetId));
    const blockedXTweetIds = mergeIds(current.blockedXTweetIds, block, requestIds(body.unblock))
      .filter((tweetId) => !pin.includes(tweetId) || blockedByRequest.has(tweetId));
    const next = await updateManualExampleCuration(id, {
      pinnedXTweetIds,
      blockedXTweetIds,
    });
    const learnings = await buildLearnings(agent);
    return NextResponse.json({ curation: next, learnings });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to update manual example curation' }, { status: 500 });
  }
}
