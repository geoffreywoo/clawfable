import { NextRequest, NextResponse } from 'next/server';
import { getAgent, updateAgent } from '@/lib/kv-storage';
import { getMe } from '@/lib/twitter-client';

// POST /api/agents/[id]/connect
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const body = await request.json();
    const { apiKey, apiSecret, accessToken, accessSecret } = body;
    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
      return NextResponse.json({ error: 'All four API keys are required' }, { status: 400 });
    }

    // Validate keys by calling getMe
    const keys = { appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret };
    const user = await getMe(keys);

    // Store encoded
    await updateAgent(id, {
      apiKey: Buffer.from(apiKey).toString('base64'),
      apiSecret: Buffer.from(apiSecret).toString('base64'),
      accessToken: Buffer.from(accessToken).toString('base64'),
      accessSecret: Buffer.from(accessSecret).toString('base64'),
      isConnected: 1,
      xUserId: user.id,
    });

    return NextResponse.json({ success: true, user: { name: user.name, username: user.username } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid API keys';
    return NextResponse.json({ error: `Failed to validate keys: ${message}` }, { status: 401 });
  }
}
