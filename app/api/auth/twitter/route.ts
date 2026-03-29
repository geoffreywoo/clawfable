import { NextRequest, NextResponse } from 'next/server';
import { saveOAuthTemp } from '@/lib/kv-storage';
import { generateOAuthLink } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/auth/twitter — start OAuth flow to connect an agent to X
// Requires login. Verifies the user owns the agent.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId } = body;
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // Verify login + ownership
    await requireAgentAccess(agentId);

    const origin = process.env.APP_URL || request.headers.get('origin') || request.nextUrl.origin;
    const callbackUrl = `${origin}/api/auth/twitter/callback`;

    const { url, oauthToken, oauthTokenSecret } = await generateOAuthLink(callbackUrl);

    await saveOAuthTemp(oauthToken, { oauthTokenSecret, agentId, purpose: 'connect' });

    return NextResponse.json({ url });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to start OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
