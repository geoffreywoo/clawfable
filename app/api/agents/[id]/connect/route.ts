import { NextRequest, NextResponse } from 'next/server';
import { updateAgent } from '@/lib/kv-storage';
import { getMe } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { findExistingConnectedAgentByXUserId } from '@/lib/x-account-conflicts';

// POST /api/agents/[id]/connect
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const body = await request.json();
    const { apiKey, apiSecret, accessToken, accessSecret } = body;
    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
      return NextResponse.json({ error: 'All four API keys are required' }, { status: 400 });
    }

    // Validate keys by calling getMe
    const keys = { appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret };
    const user = await getMe(keys);

    const duplicateAgent = await findExistingConnectedAgentByXUserId(user.id, id);
    if (duplicateAgent) {
      return NextResponse.json({
        error: `This X account is already connected to agent ${duplicateAgent.handle || duplicateAgent.id}.`,
        duplicateAgentId: duplicateAgent.id,
      }, { status: 409 });
    }

    // Store encoded and advance setup step
    const updates: Record<string, unknown> = {
      apiKey: Buffer.from(apiKey).toString('base64'),
      apiSecret: Buffer.from(apiSecret).toString('base64'),
      accessToken: Buffer.from(accessToken).toString('base64'),
      accessSecret: Buffer.from(accessSecret).toString('base64'),
      isConnected: 1,
      xUserId: user.id,
    };
    // Advance setup if on oauth step
    if (agent.setupStep === 'oauth') {
      updates.setupStep = 'soul';
    }
    await updateAgent(id, updates as Parameters<typeof updateAgent>[1]);

    return NextResponse.json({ success: true, user: { name: user.name, username: user.username } });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Invalid API keys';
    return NextResponse.json({ error: `Failed to validate keys: ${message}` }, { status: 401 });
  }
}
