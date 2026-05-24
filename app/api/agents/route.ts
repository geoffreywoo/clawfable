import { NextRequest, NextResponse } from 'next/server';
import {
  AgentHandleConflictError,
  createAgent,
  addAgentToUser,
  logFunnelEvent,
  getAgentByHandle,
} from '@/lib/kv-storage';
import { canAccessAgent, getAccessibleAgentCount } from '@/lib/account-access';
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
  let user: Awaited<ReturnType<typeof requireUser>> | null = null;
  try {
    user = await requireUser();
    const agentCount = await getAccessibleAgentCount(user);
    assertCanCreateAgent(user, agentCount);

    const body = await request.json();
    const { handle, name, soulMd } = body;
    if (!handle || !name || !soulMd) {
      return NextResponse.json({ error: 'handle, name, and soulMd are required' }, { status: 400 });
    }
    const cleanHandle = handle.replace(/^@/, '').trim();

    const existingAgent = await getAgentByHandle(cleanHandle);
    if (existingAgent) {
      if (await canAccessAgent(user, existingAgent.id, existingAgent)) {
        await addAgentToUser(user.id, existingAgent.id);
        return NextResponse.json({ ...existingAgent, created: false, reused: true });
      }

      return NextResponse.json({
        error: `An agent for @${existingAgent.handle} already exists. Log in as the original primary account or choose a different handle.`,
      }, { status: 409 });
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

    return NextResponse.json({ ...agent, created: true, reused: false });
  } catch (err) {
    if (err instanceof AgentHandleConflictError) {
      const existingAgent = await getAgentByHandle(err.handle);
      if (user && existingAgent && await canAccessAgent(user, existingAgent.id, existingAgent)) {
        await addAgentToUser(user.id, existingAgent.id);
        return NextResponse.json({ ...existingAgent, created: false, reused: true });
      }

      return NextResponse.json({
        error: err.message || `An agent for @${err.handle} already exists.`,
      }, { status: 409 });
    }
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
