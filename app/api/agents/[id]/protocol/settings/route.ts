import { NextRequest, NextResponse } from 'next/server';
import { getProtocolSettings, updateProtocolSettings, getPostLog, getAnalysis, saveBaseline } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/protocol/settings
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const settings = await getProtocolSettings(id);
    const postLog = await getPostLog(id, 10);
    return NextResponse.json({ settings, postLog });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PATCH /api/agents/[id]/protocol/settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const body = await request.json();

    const allowed: (keyof Parameters<typeof updateProtocolSettings>[1])[] = [
      'enabled', 'postsPerDay', 'minQueueSize',
      'autoReply', 'maxRepliesPerRun', 'replyIntervalMins',
      'lengthMix', 'enabledFormats', 'qtRatio',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    // Freeze baseline on first autopilot enable
    if (updates.enabled === true) {
      const analysis = await getAnalysis(id);
      if (analysis?.engagementPatterns) {
        await saveBaseline(id, {
          avgLikes: analysis.engagementPatterns.avgLikes || 0,
          avgRetweets: analysis.engagementPatterns.avgRetweets || 0,
          tweetCount: analysis.tweetCount || 0,
          snapshotDate: new Date().toISOString(),
        });
      }
    }

    const settings = await updateProtocolSettings(id, updates);
    return NextResponse.json(settings);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
