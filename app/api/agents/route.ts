import { NextRequest, NextResponse } from 'next/server';
import {
  getUserAgents,
  getTweets,
  getMentions,
  createAgent,
  addAgentToUser,
} from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { requireUser, handleAuthError } from '@/lib/auth';

// GET /api/agents — list current user's agents
export async function GET() {
  try {
    const user = await requireUser();
    const agents = await getUserAgents(user.id);
    const safe = await Promise.all(
      agents.map(async (a) => ({
        id: a.id,
        handle: a.handle,
        name: a.name,
        soulSummary: a.soulSummary,
        soulMdPreview: a.soulMd.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '',
        isConnected: a.isConnected,
        xUserId: a.xUserId,
        setupStep: a.setupStep || 'ready',
        createdAt: a.createdAt,
        tweetCount: (await getTweets(a.id)).length,
        mentionCount: (await getMentions(a.id)).length,
      }))
    );
    return NextResponse.json(safe);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// POST /api/agents — create a new agent for the current user
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const { handle, name, soulMd } = body;
    if (!handle || !name || !soulMd) {
      return NextResponse.json({ error: 'handle, name, and soulMd are required' }, { status: 400 });
    }
    const cleanHandle = handle.replace(/^@/, '').trim();
    const voiceProfile = parseSoulMd(name, soulMd);
    const agent = await createAgent({
      handle: cleanHandle,
      name,
      soulMd,
      soulSummary: voiceProfile.summary,
      apiKey: null,
      apiSecret: null,
      accessToken: null,
      accessSecret: null,
      isConnected: 0,
      xUserId: null,
      setupStep: 'oauth',
    });

    // Link agent to user
    await addAgentToUser(user.id, agent.id);

    return NextResponse.json(agent);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
