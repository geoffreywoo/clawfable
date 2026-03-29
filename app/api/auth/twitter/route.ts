import { NextRequest, NextResponse } from 'next/server';
import { getAgent, saveOAuthTemp } from '@/lib/kv-storage';
import { generateOAuthLink } from '@/lib/twitter-client';

// POST /api/auth/twitter — start OAuth flow for an agent
// Body: { agentId: string }
// Returns: { url: string } — redirect user here
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId } = body;
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Build callback URL — use NEXTAUTH_URL or APP_URL env var if set, else derive from request
    const origin = process.env.APP_URL || request.headers.get('origin') || request.nextUrl.origin;
    const callbackUrl = `${origin}/api/auth/twitter/callback`;

    const { url, oauthToken, oauthTokenSecret } = await generateOAuthLink(callbackUrl);

    // Store the temp secret + agentId keyed by oauthToken so the callback can find it
    await saveOAuthTemp(oauthToken, { oauthTokenSecret, agentId });

    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
