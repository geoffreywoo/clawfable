import { NextRequest, NextResponse } from 'next/server';
import { createTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getAgentQueueFeed } from '@/lib/dashboard-data';
import { validateQueueCreateRequest } from '@/lib/request-validation';

// GET /api/agents/[id]/queue
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    return NextResponse.json(await getAgentQueueFeed(id));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }
}

// POST /api/agents/[id]/queue
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const body = await request.json();
    const parsed = validateQueueCreateRequest(body);
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid queue request' }, { status: 400 });
    }
    const { content, topic, type, quoteTweetId, quoteTweetAuthor } = parsed.value;

    const tweet = await createTweet({
      agentId: id,
      content,
      type: type || 'original',
      status: 'queued',
      topic: topic || null,
      xTweetId: null,
      quoteTweetId: quoteTweetId || null,
      quoteTweetAuthor: quoteTweetAuthor || null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to add to queue' }, { status: 500 });
  }
}
