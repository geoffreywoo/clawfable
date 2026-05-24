import { NextRequest, NextResponse } from 'next/server';
import { getOAuthTemp, deleteOAuthTemp, getOrCreateUser, createSession, getUserAgentIds, createAgent, addAgentToUser, createMention, getAgentByHandle, getAgent, updateAgent } from '@/lib/kv-storage';
import { getMentionsFromTwitter } from '@/lib/twitter-client';
import { exchangeOAuthTokens } from '@/lib/twitter-client';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { COOKIE_NAME } from '@/lib/auth';
import { findExistingConnectedAgentByXUserId } from '@/lib/x-account-conflicts';
import { getPresetSoulProfile } from '@/lib/open-source-souls';
import { resolveRequestOrigin } from '@/lib/request-origin';
import { getSessionCookieOptions } from '@/lib/session-cookie';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

async function seedMentions(agentId: string, consumerKey: string, consumerSecret: string, accessToken: string, accessSecret: string, userId: string): Promise<void> {
  try {
    const agentKeys = {
      appKey: consumerKey,
      appSecret: consumerSecret,
      accessToken,
      accessSecret,
    };
    const rawMentions = await getMentionsFromTwitter(agentKeys, userId);
    for (const m of rawMentions) {
      await createMention({
        agentId,
        author: String(m.authorName || m.authorId),
        authorHandle: `@${String(m.authorUsername || m.authorId)}`,
        content: m.text,
        tweetId: m.id,
        conversationId: m.conversationId || null,
        inReplyToTweetId: m.inReplyToTweetId || null,
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: m.createdAt,
      });
    }
  } catch {
    // Non-critical — mentions will be fetched by cron later
  }
}

async function connectLoginAgent(agentId: string, screenName: string, userId: string, accessToken: string, accessSecret: string): Promise<void> {
  const consumerKey = process.env.TWITTER_CONSUMER_KEY!.trim();
  const consumerSecret = process.env.TWITTER_CONSUMER_SECRET!.trim();
  const agent = await getAgent(agentId);
  const updates: Record<string, unknown> = {
    handle: screenName,
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
  await seedMentions(agentId, consumerKey, consumerSecret, accessToken, accessSecret, userId);
}

// GET /api/auth/login/callback — Twitter redirects here after user authorizes
export async function GET(request: NextRequest) {
  const oauthToken = request.nextUrl.searchParams.get('oauth_token');
  const oauthVerifier = request.nextUrl.searchParams.get('oauth_verifier');
  const denied = request.nextUrl.searchParams.get('denied');
  const origin = resolveRequestOrigin(request);

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
    const { accessToken, accessSecret, userId, screenName } = await exchangeOAuthTokens(
      oauthToken, oauthTokenSecret, oauthVerifier
    );

    // Create or get user
    await getOrCreateUser(userId, screenName, screenName);

    // Create session
    const sessionToken = await createSession(userId);

    // Clean up temp
    await deleteOAuthTemp(oauthToken);

    const existingAgents = await getUserAgentIds(userId);
    await Promise.all(existingAgents.map((agentId) => addAgentToUser(userId, agentId)));
    let redirectPath = CONTROL_ROOM_PATH;

    const duplicateAgent = await findExistingConnectedAgentByXUserId(userId);
    if (duplicateAgent) {
      await addAgentToUser(userId, duplicateAgent.id);
      await connectLoginAgent(duplicateAgent.id, screenName, userId, accessToken, accessSecret);
      redirectPath = `/agent/${duplicateAgent.id}?oauth=success&username=${screenName}`;
      const response = NextResponse.redirect(new URL(redirectPath, origin));
      response.cookies.set(COOKIE_NAME, sessionToken, getSessionCookieOptions(origin, { maxAge: THIRTY_DAYS }));
      return response;
    }

    const handleAgent = await getAgentByHandle(screenName);
    if (handleAgent) {
      await addAgentToUser(userId, handleAgent.id);
      await connectLoginAgent(handleAgent.id, screenName, userId, accessToken, accessSecret);
      redirectPath = `/agent/${handleAgent.id}?oauth=success&username=${screenName}`;
      const response = NextResponse.redirect(new URL(redirectPath, origin));
      response.cookies.set(COOKIE_NAME, sessionToken, getSessionCookieOptions(origin, { maxAge: THIRTY_DAYS }));
      return response;
    }

    if (existingAgents.length === 0) {
      const consumerKey = process.env.TWITTER_CONSUMER_KEY!.trim();
      const consumerSecret = process.env.TWITTER_CONSUMER_SECRET!.trim();

      // If forking from an existing agent, pre-fill the SOUL.md
      let soulMd = '# Pending SOUL.md setup';
      let soulSummary: string | null = null;
      let setupStep: 'soul' | 'analyze' = 'soul';
      if (temp.forkHandle) {
        const sourceAgent = await getAgentByHandle(temp.forkHandle);
        if (sourceAgent && sourceAgent.soulMd && sourceAgent.soulMd.length > 50) {
          soulMd = sourceAgent.soulMd;
          soulSummary = sourceAgent.soulSummary;
          setupStep = 'analyze'; // skip voice definition, go straight to analysis
        } else {
          const presetSoul = getPresetSoulProfile(temp.forkHandle);
          if (presetSoul) {
            soulMd = presetSoul.soulMd;
            soulSummary = presetSoul.soulSummary;
            setupStep = 'analyze';
          }
        }
      }

      const agent = await createAgent({
        handle: screenName,
        name: screenName,
        soulMd,
        soulSummary,
        apiKey: Buffer.from(consumerKey).toString('base64'),
        apiSecret: Buffer.from(consumerSecret).toString('base64'),
        accessToken: Buffer.from(accessToken.trim()).toString('base64'),
        accessSecret: Buffer.from(accessSecret.trim()).toString('base64'),
        isConnected: 1,
        xUserId: userId,
        setupStep,
      });

      await addAgentToUser(userId, agent.id);

      await seedMentions(agent.id, consumerKey, consumerSecret, accessToken, accessSecret, userId);

      // Redirect to agent dashboard with setup continuation
      redirectPath = `/agent/${agent.id}?oauth=success&username=${screenName}`;
    }

    const response = NextResponse.redirect(new URL(redirectPath, origin));
    response.cookies.set(COOKIE_NAME, sessionToken, getSessionCookieOptions(origin, { maxAge: THIRTY_DAYS }));

    return response;
  } catch (err) {
    console.error('Login callback error:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/?auth=error', origin));
  }
}
