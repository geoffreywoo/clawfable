import { NextRequest, NextResponse } from 'next/server';
import { getOAuthTemp, deleteOAuthTemp, getOrCreateUser, createSession, getUserAgentIds, createAgent, addAgentToUser, createMention, getMentions } from '@/lib/kv-storage';
import { getMentionsFromTwitter, getMe } from '@/lib/twitter-client';
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
    const { accessToken, accessSecret, userId, screenName } = await exchangeOAuthTokens(
      oauthToken, oauthTokenSecret, oauthVerifier
    );

    // Create or get user
    await getOrCreateUser(userId, screenName, screenName);

    // Create session
    const sessionToken = await createSession(userId);

    // Clean up temp
    await deleteOAuthTemp(oauthToken);

    // If first login (no agents), auto-create an agent connected to their X account
    const existingAgents = await getUserAgentIds(userId);
    let redirectPath = '/';

    if (existingAgents.length === 0) {
      const consumerKey = process.env.TWITTER_CONSUMER_KEY!;
      const consumerSecret = process.env.TWITTER_CONSUMER_SECRET!;

      const agent = await createAgent({
        handle: screenName,
        name: screenName,
        soulMd: '# Pending SOUL.md setup',
        soulSummary: null,
        apiKey: Buffer.from(consumerKey).toString('base64'),
        apiSecret: Buffer.from(consumerSecret).toString('base64'),
        accessToken: Buffer.from(accessToken).toString('base64'),
        accessSecret: Buffer.from(accessSecret).toString('base64'),
        isConnected: 1,
        xUserId: userId,
        setupStep: 'soul',
      });

      await addAgentToUser(userId, agent.id);

      // Pre-fetch mentions so they're available immediately
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
            agentId: agent.id,
            author: String(m.authorName || m.authorId),
            authorHandle: `@${String(m.authorUsername || m.authorId)}`,
            content: m.text,
            tweetId: m.id,
            engagementLikes: 0,
            engagementRetweets: 0,
            createdAt: m.createdAt,
          });
        }
      } catch {
        // Non-critical — mentions will be fetched by cron later
      }

      // Redirect to agent dashboard with setup continuation
      redirectPath = `/agent/${agent.id}?oauth=success&username=${screenName}`;
    }

    const response = NextResponse.redirect(new URL(redirectPath, origin));
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
