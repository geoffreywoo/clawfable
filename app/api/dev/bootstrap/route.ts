import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { getSessionCookieOptions } from '@/lib/session-cookie';
import {
  addAgentToUser,
  createAgent,
  createSession,
  getAgentByHandle,
  getOrCreateUser,
} from '@/lib/kv-storage';
import { getPlatformGoalForHandle } from '@/lib/platform-goal';

function sanitizeHandle(value: string | null): string {
  const normalized = (value || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return normalized || 'devoperator';
}

function inferName(handle: string, explicit: string | null): string {
  const trimmed = (explicit || '').trim();
  if (trimmed) return trimmed;
  return handle
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ') || 'Dev Operator';
}

function buildSoulMd(handle: string, name: string): string {
  return `# ${name}

## Voice
- Handle: @${handle}
- Tone: direct, specific, and operator-focused
- Topics: AI agents, growth, product strategy, workflows
- Anti-goals: generic hype, filler, empty praise

## Primary Objective
${getPlatformGoalForHandle(handle)}

## Notes
- This is a local development bootstrap agent for supervised Engage testing.
- Keep replies concise, opinionated, and grounded in the target tweet.`;
}

function allowLocalDevBootstrap(request: NextRequest): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

function isProductionKvConfigured(): boolean {
  return Boolean(process.env.KV_URL || process.env.KV_REST_API_URL);
}

// GET /api/dev/bootstrap — local-only auth bootstrap for manual QA
export async function GET(request: NextRequest) {
  if (!allowLocalDevBootstrap(request)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (isProductionKvConfigured()) {
    return NextResponse.json({
      error: 'Local bootstrap is disabled while external KV credentials are configured.',
    }, { status: 403 });
  }

  const requestUrl = new URL(request.url);
  const handle = sanitizeHandle(requestUrl.searchParams.get('handle'));
  const name = inferName(handle, requestUrl.searchParams.get('name'));
  const userId = 'dev-local-user';
  const username = 'devlocal';

  const user = await getOrCreateUser(userId, username, 'Local Dev Operator');
  let agent = await getAgentByHandle(handle);
  if (!agent) {
    agent = await createAgent({
      handle,
      name,
      soulMd: buildSoulMd(handle, name),
      soulSummary: 'Local development bootstrap agent',
      apiKey: null,
      apiSecret: null,
      accessToken: null,
      accessSecret: null,
      isConnected: 0,
      xUserId: null,
      soulPublic: 0,
      setupStep: 'ready',
    });
  }

  await addAgentToUser(user.id, agent.id);

  const sessionToken = await createSession(user.id);
  const redirectUrl = new URL(`/agent/${agent.id}`, requestUrl.origin);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(COOKIE_NAME, sessionToken, getSessionCookieOptions(requestUrl.origin, {
    maxAge: 60 * 60 * 24 * 30,
  }));
  return response;
}
