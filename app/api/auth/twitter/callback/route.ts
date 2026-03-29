import { NextRequest, NextResponse } from 'next/server';
import { getOAuthTemp, deleteOAuthTemp, getAgent, updateAgent } from '@/lib/kv-storage';
import { exchangeOAuthTokens } from '@/lib/twitter-client';

// GET /api/auth/twitter/callback — Twitter redirects here after user authorizes
// Query params: oauth_token, oauth_verifier
export async function GET(request: NextRequest) {
  const oauthToken = request.nextUrl.searchParams.get('oauth_token');
  const oauthVerifier = request.nextUrl.searchParams.get('oauth_verifier');
  const denied = request.nextUrl.searchParams.get('denied');

  // User denied access
  if (denied) {
    return NextResponse.redirect(new URL('/?oauth=denied', request.nextUrl.origin));
  }

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(new URL('/?oauth=error', request.nextUrl.origin));
  }

  try {
    // Look up the temp data we stored when starting the flow
    const temp = await getOAuthTemp(oauthToken);
    if (!temp) {
      return NextResponse.redirect(new URL('/?oauth=expired', request.nextUrl.origin));
    }

    const { oauthTokenSecret, agentId } = temp;

    // Exchange for permanent access tokens
    const { accessToken, accessSecret, userId, screenName } =
      await exchangeOAuthTokens(oauthToken, oauthTokenSecret, oauthVerifier);

    // Store on the agent (base64 encoded, using app consumer key/secret)
    const consumerKey = process.env.TWITTER_CONSUMER_KEY!;
    const consumerSecret = process.env.TWITTER_CONSUMER_SECRET!;

    const agent = await getAgent(agentId);
    const updates: Record<string, unknown> = {
      apiKey: Buffer.from(consumerKey).toString('base64'),
      apiSecret: Buffer.from(consumerSecret).toString('base64'),
      accessToken: Buffer.from(accessToken).toString('base64'),
      accessSecret: Buffer.from(accessSecret).toString('base64'),
      isConnected: 1,
      xUserId: userId,
    };

    // Advance setup step if needed
    if (agent && (agent.setupStep === 'oauth' || !agent.setupStep)) {
      updates.setupStep = 'soul';
    }

    await updateAgent(agentId, updates as Parameters<typeof updateAgent>[1]);

    // Clean up temp token
    await deleteOAuthTemp(oauthToken);

    // Redirect to the agent dashboard
    return NextResponse.redirect(
      new URL(`/agent/${agentId}?oauth=success&username=${screenName}`, request.nextUrl.origin)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth failed';
    console.error('OAuth callback error:', message);
    return NextResponse.redirect(new URL('/?oauth=error', request.nextUrl.origin));
  }
}
