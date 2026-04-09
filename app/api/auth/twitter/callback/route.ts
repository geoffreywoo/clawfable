import { NextRequest, NextResponse } from 'next/server';
import { getOAuthTemp, deleteOAuthTemp, getAgent, updateAgent } from '@/lib/kv-storage';
import { exchangeOAuthTokens } from '@/lib/twitter-client';
import { findExistingConnectedAgentByXUserId } from '@/lib/x-account-conflicts';

// GET /api/auth/twitter/callback — Twitter redirects here after user authorizes agent connection
export async function GET(request: NextRequest) {
  const oauthToken = request.nextUrl.searchParams.get('oauth_token');
  const oauthVerifier = request.nextUrl.searchParams.get('oauth_verifier');
  const denied = request.nextUrl.searchParams.get('denied');
  const origin = process.env.APP_URL || request.nextUrl.origin;

  if (denied) {
    return NextResponse.redirect(new URL('/?oauth=denied', origin));
  }

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(new URL('/?oauth=error', origin));
  }

  try {
    const temp = await getOAuthTemp(oauthToken);
    if (!temp || temp.purpose !== 'connect' || !temp.agentId) {
      return NextResponse.redirect(new URL('/?oauth=expired', origin));
    }

    const { oauthTokenSecret, agentId } = temp;

    const { accessToken, accessSecret, userId, screenName } =
      await exchangeOAuthTokens(oauthToken, oauthTokenSecret, oauthVerifier);

    const duplicateAgent = await findExistingConnectedAgentByXUserId(userId, agentId);
    if (duplicateAgent) {
      await deleteOAuthTemp(oauthToken);
      return NextResponse.redirect(
        new URL(`/agent/${duplicateAgent.id}?oauth=duplicate&username=${screenName}`, origin)
      );
    }

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

    if (agent && (agent.setupStep === 'oauth' || !agent.setupStep)) {
      updates.setupStep = 'soul';
    }

    await updateAgent(agentId, updates as Parameters<typeof updateAgent>[1]);
    await deleteOAuthTemp(oauthToken);

    return NextResponse.redirect(
      new URL(`/agent/${agentId}?oauth=success&username=${screenName}`, origin)
    );
  } catch (err) {
    console.error('OAuth callback error:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/?oauth=error', origin));
  }
}
