import { NextRequest, NextResponse } from 'next/server';
import { addPostLogEntry, saveOAuthTemp } from '@/lib/kv-storage';
import { formatOAuthStartError } from '@/lib/oauth-start-error';
import { resolveRequestOrigin } from '@/lib/request-origin';
import { generateOAuthLink } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/auth/twitter — start OAuth flow to connect an agent to X
// Requires login. Verifies the user owns the agent.
export async function POST(request: NextRequest) {
  let agentId: string | null = null;
  try {
    const body = await request.json();
    agentId = body.agentId ? String(body.agentId) : null;
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // Verify login + ownership
    const { agent } = await requireAgentAccess(agentId);

    const origin = resolveRequestOrigin(request);
    const callbackUrl = `${origin}/api/auth/twitter/callback`;

    const { url, oauthToken, oauthTokenSecret } = await generateOAuthLink(callbackUrl);

    await saveOAuthTemp(oauthToken, {
      oauthTokenSecret,
      agentId,
      purpose: 'connect',
      createdAt: new Date().toISOString(),
    });
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'x_auth_connect_start',
      topic: 'auth',
      postedAt: new Date().toISOString(),
      source: 'manual',
      reason: `Started X connect flow for @${agent.handle}. Waiting for X callback to attach tokens to this agent.`,
    });

    return NextResponse.json({ url });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    if (agentId) {
      await addPostLogEntry(agentId, {
        agentId,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'x_auth_connect_start_error',
        topic: 'auth',
        postedAt: new Date().toISOString(),
        source: 'manual',
        reason: `Failed to start X connect flow: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => null);
    }
    console.error('Agent connect OAuth start error:', err instanceof Error ? err.message : err);
    const message = formatOAuthStartError(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
