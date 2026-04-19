import { NextRequest, NextResponse } from 'next/server';
import { saveOAuthTemp } from '@/lib/kv-storage';
import { formatOAuthStartError } from '@/lib/oauth-start-error';
import { resolveRequestOrigin } from '@/lib/request-origin';
import { generateOAuthLink } from '@/lib/twitter-client';

// POST /api/auth/login — start login OAuth flow
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forkHandle = typeof body.forkHandle === 'string' ? body.forkHandle.trim() : undefined;

    const origin = resolveRequestOrigin(request);
    const callbackUrl = `${origin}/api/auth/login/callback`;

    const { url, oauthToken, oauthTokenSecret } = await generateOAuthLink(callbackUrl);

    await saveOAuthTemp(oauthToken, {
      oauthTokenSecret,
      agentId: null,
      purpose: 'login',
      forkHandle,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ url });
  } catch (err) {
    console.error('Login start error:', err instanceof Error ? err.message : err);
    const message = formatOAuthStartError(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
