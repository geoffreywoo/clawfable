import { NextRequest, NextResponse } from 'next/server';
import { addPostLogEntry, getOAuthTemp, deleteOAuthTemp, getAgent, updateAgent } from '@/lib/kv-storage';
import { exchangeOAuthTokens } from '@/lib/twitter-client';
import { findExistingConnectedAgentByXUserId } from '@/lib/x-account-conflicts';
import { resolveRequestOrigin } from '@/lib/request-origin';

// GET /api/auth/twitter/callback — Twitter redirects here after user authorizes agent connection
export async function GET(request: NextRequest) {
  const oauthToken = request.nextUrl.searchParams.get('oauth_token');
  const oauthVerifier = request.nextUrl.searchParams.get('oauth_verifier');
  const denied = request.nextUrl.searchParams.get('denied');
  const origin = resolveRequestOrigin(request);

  if (denied) {
    const deniedTemp = await getOAuthTemp(denied).catch(() => null);
    if (deniedTemp?.purpose === 'connect' && deniedTemp.agentId) {
      await addPostLogEntry(deniedTemp.agentId, {
        agentId: deniedTemp.agentId,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'x_auth_denied',
        topic: 'auth',
        postedAt: new Date().toISOString(),
        source: 'manual',
        reason: 'X connect flow was canceled on X before tokens were attached to this agent.',
      }).catch(() => null);
      await deleteOAuthTemp(denied).catch(() => null);
    }
    return NextResponse.redirect(new URL('/?oauth=denied', origin));
  }

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(new URL('/?oauth=error', origin));
  }

  let temp: Awaited<ReturnType<typeof getOAuthTemp>> = null;

  try {
    temp = await getOAuthTemp(oauthToken);
    if (!temp || temp.purpose !== 'connect' || !temp.agentId) {
      return NextResponse.redirect(new URL('/?oauth=expired', origin));
    }

    const { oauthTokenSecret, agentId } = temp;

    const { accessToken, accessSecret, userId, screenName } =
      await exchangeOAuthTokens(oauthToken, oauthTokenSecret, oauthVerifier);

    const duplicateAgent = await findExistingConnectedAgentByXUserId(userId, agentId);
    if (duplicateAgent) {
      await addPostLogEntry(agentId, {
        agentId,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'x_auth_duplicate',
        topic: 'auth',
        postedAt: new Date().toISOString(),
        source: 'manual',
        reason: `This X account is already attached to agent ${duplicateAgent.id} (@${duplicateAgent.handle}).`,
      }).catch(() => null);
      await deleteOAuthTemp(oauthToken);
      return NextResponse.redirect(
        new URL(`/agent/${duplicateAgent.id}?oauth=duplicate&username=${screenName}`, origin)
      );
    }

    const consumerKey = process.env.TWITTER_CONSUMER_KEY!.trim();
    const consumerSecret = process.env.TWITTER_CONSUMER_SECRET!.trim();

    const agent = await getAgent(agentId);
    const updates: Record<string, unknown> = {
      apiKey: Buffer.from(consumerKey).toString('base64'),
      apiSecret: Buffer.from(consumerSecret).toString('base64'),
      accessToken: Buffer.from(accessToken.trim()).toString('base64'),
      accessSecret: Buffer.from(accessSecret.trim()).toString('base64'),
      isConnected: 1,
      xUserId: userId,
    };

    if (agent && (agent.setupStep === 'oauth' || !agent.setupStep)) {
      updates.setupStep = 'soul';
    }

    await updateAgent(agentId, updates as Parameters<typeof updateAgent>[1]);
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'x_auth_connected',
      topic: 'auth',
      postedAt: new Date().toISOString(),
      source: 'manual',
      reason: `Attached X account @${screenName} to this agent using the current X app credentials.`,
    }).catch(() => null);
    await deleteOAuthTemp(oauthToken);

    return NextResponse.redirect(
      new URL(`/agent/${agentId}?oauth=success&username=${screenName}`, origin)
    );
  } catch (err) {
    if (temp?.agentId) {
      await addPostLogEntry(temp.agentId, {
        agentId: temp.agentId,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'x_auth_callback_error',
        topic: 'auth',
        postedAt: new Date().toISOString(),
        source: 'manual',
        reason: `X callback failed before tokens were attached: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => null);
    }
    if (oauthToken) {
      await deleteOAuthTemp(oauthToken).catch(() => null);
    }
    console.error('OAuth callback error:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/?oauth=error', origin));
  }
}
