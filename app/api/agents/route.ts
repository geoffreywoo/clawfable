import { NextRequest, NextResponse } from 'next/server';
import {
  getUserAgents,
  getUserAgentIds,
  getTweets,
  getMentions,
  createAgent,
  addAgentToUser,
  logFunnelEvent,
  getAgentByHandle,
} from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { requireUser, handleAuthError } from '@/lib/auth';
import { normalizeSetupStep } from '@/lib/setup-state';
import { assertCanCreateAgent, BillingError } from '@/lib/billing';

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
        setupStep: normalizeSetupStep(a.setupStep),
        createdAt: a.createdAt,
        tweetCount: (await getTweets(a.id)).filter((tweet) => tweet.status !== 'preview').length,
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
    const agentCount = (await getUserAgentIds(user.id)).length;
    assertCanCreateAgent(user, agentCount);

    const body = await request.json();
    const { handle, name, soulMd } = body;
    if (!handle || !name || !soulMd) {
      return NextResponse.json({ error: 'handle, name, and soulMd are required' }, { status: 400 });
    }
    const cleanHandle = handle.replace(/^@/, '').trim();

    // Prevent duplicate agents for the same X handle
    const existingAgent = await getAgentByHandle(cleanHandle);
    if (existingAgent && existingAgent.setupStep === 'ready' && existingAgent.isConnected) {
      return NextResponse.json({ error: `An agent for @${cleanHandle} already exists and is active.` }, { status: 409 });
    }

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

    // Funnel: wizard started
    await logFunnelEvent(agent.id, 'wizard_start', { handle: cleanHandle });

    return NextResponse.json(agent);
  } catch (err) {
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
