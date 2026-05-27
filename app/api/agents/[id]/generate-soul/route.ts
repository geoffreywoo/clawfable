import { NextRequest, NextResponse } from 'next/server';
import { addPostLogEntry, invalidateAgentConnection, updateAgent } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { decodeKeys } from '@/lib/twitter-client';
import { generateSoulFromTweets } from '@/lib/soul-from-tweets';
import { parseSoulMd } from '@/lib/soul-parser';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError, isTwitterCreditsDepletedError } from '@/lib/twitter-debug';

// POST /api/agents/[id]/generate-soul — generate SOUL.md from tweet history
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let agentForLog: { handle?: string; xUserId?: string | null } | null = null;
  try {
    const { agent } = await requireAgentAccess(id);
    agentForLog = { handle: agent.handle, xUserId: agent.xUserId ? String(agent.xUserId) : null };

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
      return NextResponse.json({ error: 'X API must be connected first' }, { status: 400 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const result = await generateSoulFromTweets(keys, agent.xUserId, agent.name);

    // Save the generated SOUL.md to the agent
    const voiceProfile = parseSoulMd(agent.name, result.soulMd);
    const updates: Record<string, unknown> = {
      soulMd: result.soulMd,
      soulSummary: voiceProfile.summary,
    };
    // Advance setup step past soul
    if (agent.setupStep === 'soul') {
      updates.setupStep = 'analyze';
    }
    await updateAgent(id, updates as Parameters<typeof updateAgent>[1]);

    return NextResponse.json(result);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const invalidCredentials = isInvalidTwitterCredentialError(err);
    const creditsDepleted = isTwitterCreditsDepletedError(err);
    const rateLimited = isRateLimitTwitterError(err);
    const transient = !creditsDepleted && !rateLimited && isTransientTwitterError(err);

    if (invalidCredentials || creditsDepleted || rateLimited || transient) {
      const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
      const message = invalidCredentials
        ? 'X credentials rejected by X. Agent disconnected, reconnect in Settings.'
        : creditsDepleted
          ? 'X API credits are depleted, so Clawfable cannot read tweet history right now. Use the guided voice builder or refill X API credits and retry.'
          : rateLimited
            ? `X tweet-history read rate limited${resetAt ? ` until ${resetAt}` : ''}. Try again after the reset.`
            : 'Temporary X tweet-history read failure. Try again in a few minutes.';

      if (invalidCredentials) {
        await invalidateAgentConnection(id).catch(() => null);
      }

      await addPostLogEntry(id, {
        agentId: id,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'generate_soul_error',
        topic: 'voice_contract',
        postedAt: new Date().toISOString(),
        source: 'manual',
        action: 'error',
        reason: `${message} ${formatActionError(err, 'generate_soul_from_history', {
          handle: agentForLog?.handle ? `@${agentForLog.handle}` : undefined,
          xUserId: agentForLog?.xUserId,
        })}`,
        errorCode: invalidCredentials
          ? 'x_invalid_credentials'
          : creditsDepleted
            ? 'x_credits_depleted'
            : rateLimited
              ? 'x_rate_limit'
              : 'x_transient',
      }).catch(() => null);

      return NextResponse.json(
        { error: message, ...(resetAt ? { resetAt } : {}) },
        { status: invalidCredentials ? 401 : creditsDepleted ? 402 : rateLimited ? 429 : 503 },
      );
    }

    const message = err instanceof Error ? err.message : 'Failed to generate SOUL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
