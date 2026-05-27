import { NextRequest, NextResponse } from 'next/server';
import { addPostLogEntry, checkRateLimit, invalidateAgentConnection, saveAnalysis, updateAgent } from '@/lib/kv-storage';
import { decodeKeys } from '@/lib/twitter-client';
import { analyzeAccount } from '@/lib/analysis';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getPostAnalysisStep } from '@/lib/setup-state';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError, isTwitterCreditsDepletedError } from '@/lib/twitter-debug';

// POST /api/agents/[id]/analyze — run account analysis
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let agentForLog: { handle?: string; xUserId?: string | null } | null = null;
  try {
    const { agent } = await requireAgentAccess(id);
    agentForLog = { handle: agent.handle, xUserId: agent.xUserId ? String(agent.xUserId) : null };

    // Rate limit: 5 analyses per hour per agent (expensive operation)
    const allowed = await checkRateLimit(id, 'analyze', 5);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
    }

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not connected' }, { status: 400 });
    }
    if (!agent.xUserId) {
      return NextResponse.json({ error: 'Twitter user ID not set' }, { status: 400 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const analysis = await analyzeAccount(keys, agent.xUserId, id);
    await saveAnalysis(id, analysis);

    // Analysis unlocks preview, but launch approval is what makes the agent ready.
    if (agent.setupStep === 'analyze') {
      await updateAgent(id, { setupStep: getPostAnalysisStep(agent.setupStep) });
    }

    return NextResponse.json(analysis);
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
          ? 'X API credits are depleted, so Clawfable cannot analyze tweet history right now. Use the guided voice builder or refill X API credits and retry.'
          : rateLimited
            ? `X account analysis rate limited${resetAt ? ` until ${resetAt}` : ''}. Try again after the reset.`
            : 'Temporary X account analysis failure. Try again in a few minutes.';

      if (invalidCredentials) {
        await invalidateAgentConnection(id).catch(() => null);
      }

      await addPostLogEntry(id, {
        agentId: id,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'account_analysis_error',
        topic: 'account_analysis',
        postedAt: new Date().toISOString(),
        source: 'manual',
        action: 'error',
        reason: `${message} ${formatActionError(err, 'analyze_account', {
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

    const message = err instanceof Error ? err.message : 'Analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
