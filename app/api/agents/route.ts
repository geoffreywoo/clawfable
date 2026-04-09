import { NextRequest, NextResponse } from 'next/server';
import {
  createAgent,
  addAgentToUser,
  logFunnelEvent,
  getAgentByHandle,
} from '@/lib/kv-storage';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { parseSoulMd } from '@/lib/soul-parser';
import { requireUser, handleAuthError } from '@/lib/auth';
import { assertCanCreateAgent, BillingError } from '@/lib/billing';
import { getAgentSummariesForUser } from '@/lib/dashboard-data';

// GET /api/agents — list current user's agents
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getAgentSummariesForUser(user));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// POST /api/agents — create a new agent for the current user
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const agentCount = await getAccessibleAgentCount(user);
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
