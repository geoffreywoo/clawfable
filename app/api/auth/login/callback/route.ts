import { NextRequest, NextResponse } from 'next/server';
import { getOAuthTemp, deleteOAuthTemp, getOrCreateUser, createSession } from '@/lib/kv-storage';
import { exchangeOAuthTokens } from '@/lib/twitter-client';
import { COOKIE_NAME } from '@/lib/auth';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

// GET /api/auth/login/callback — Twitter redirects here after user authorizes
export async function GET(request: NextRequest) {
  const oauthToken = request.nextUrl.searchParams.get('oauth_token');
  const oauthVerifier = request.nextUrl.searchParams.get('oauth_verifier');
  const denied = request.nextUrl.searchParams.get('denied');
  const origin = process.env.APP_URL || request.nextUrl.origin;

  if (denied) {
    return NextResponse.redirect(new URL('/?auth=denied', origin));
  }

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(new URL('/?auth=error', origin));
  }

  try {
    const temp = await getOAuthTemp(oauthToken);
    if (!temp || temp.purpose !== 'login') {
      return NextResponse.redirect(new URL('/?auth=expired', origin));
    }

    const { oauthTokenSecret } = temp;
    const { userId, screenName } = await exchangeOAuthTokens(
      oauthToken, oauthTokenSecret, oauthVerifier
    );

    // Create or get user
    await getOrCreateUser(userId, screenName, screenName);

    // Create session
    const sessionToken = await createSession(userId);

    // Clean up
    await deleteOAuthTemp(oauthToken);

    // Redirect with session cookie
    const response = NextResponse.redirect(new URL('/', origin));
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: THIRTY_DAYS,
    });

    return response;
  } catch (err) {
    console.error('Login callback error:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/?auth=error', origin));
  }
}
