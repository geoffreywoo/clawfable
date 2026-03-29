import { NextRequest, NextResponse } from 'next/server';
import { updateAgent } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/disconnect
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    await updateAgent(id, {
      apiKey: null,
      apiSecret: null,
      accessToken: null,
      accessSecret: null,
      isConnected: 0,
      xUserId: null,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
