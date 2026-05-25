import { NextRequest, NextResponse } from 'next/server';
import { saveOAuthTemp } from '@/lib/kv-storage';
import { formatOAuthStartError } from '@/lib/oauth-start-error';
import { resolveRequestOrigin } from '@/lib/request-origin';
import { generateOAuthLink } from '@/lib/twitter-client';

function expectsJson(request: NextRequest): boolean {
  const contentType = request.headers.get('content-type') ?? '';
  const accept = request.headers.get('accept') ?? '';
  return contentType.includes('application/json') || accept.includes('application/json');
}

// POST /api/auth/login — start login OAuth flow
export async function POST(request: NextRequest) {
  let callbackUrl: string | null = null;
  const jsonResponse = expectsJson(request);
  try {
    const body = await request.json().catch(() => ({}));
    const forkHandle = typeof body.forkHandle === 'string' ? body.forkHandle.trim() : undefined;

    const origin = resolveRequestOrigin(request);
    callbackUrl = `${origin}/api/auth/login/callback`;

    const { url, oauthToken, oauthTokenSecret } = await generateOAuthLink(callbackUrl);

    await saveOAuthTemp(oauthToken, {
      oauthTokenSecret,
      agentId: null,
      purpose: 'login',
      forkHandle,
      createdAt: new Date().toISOString(),
    });

    if (!jsonResponse) {
      return NextResponse.redirect(url, { status: 303 });
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error('Login start error:', err instanceof Error ? err.message : err);
    const message = formatOAuthStartError(err, { callbackUrl });
    if (!jsonResponse) {
      const origin = resolveRequestOrigin(request);
      const redirected = new URL('/', origin);
      redirected.searchParams.set('auth', 'error');
      return NextResponse.redirect(redirected, { status: 303 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
