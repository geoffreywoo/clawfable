import { NextRequest, NextResponse } from 'next/server';
import { saveOAuthTemp } from '@/lib/kv-storage';
import { generateOAuthLink } from '@/lib/twitter-client';

// POST /api/auth/login — start login OAuth flow
export async function POST(request: NextRequest) {
  try {
    const origin = process.env.APP_URL || request.headers.get('origin') || request.nextUrl.origin;
    const callbackUrl = `${origin}/api/auth/login/callback`;

    const { url, oauthToken, oauthTokenSecret } = await generateOAuthLink(callbackUrl);

    await saveOAuthTemp(oauthToken, { oauthTokenSecret, agentId: null, purpose: 'login' });

    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start login';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
