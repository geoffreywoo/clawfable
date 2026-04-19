import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSession, getUser, getAgent } from './kv-storage';
import { canAccessAgent } from './account-access';
import type { User, Agent } from './types';

const COOKIE_NAME = 'clawfable_session';

export class AuthError extends Error {
  constructor() { super('Unauthorized'); }
}

export class NotFoundError extends Error {
  constructor(msg = 'Not found') { super(msg); }
}

/**
 * Get the current logged-in user from the session cookie.
 * Throws AuthError if not logged in.
 */
export async function requireUser(): Promise<User> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) throw new AuthError();
  const session = await getSession(token);
  if (!session) throw new AuthError();
  const user = await getUser(session.userId);
  if (!user) throw new AuthError();
  return user;
}

/**
 * Get the current user, or null if not logged in.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}

/**
 * Verify the current user owns the given agent.
 * Returns both user and agent. Throws AuthError or NotFoundError.
 */
export async function requireAgentAccess(agentId: string): Promise<{ user: User; agent: Agent }> {
  const user = await requireUser();
  const agent = await getAgent(agentId);
  if (!agent) throw new NotFoundError('Agent not found');
  if (!(await canAccessAgent(user, agentId, agent))) throw new AuthError();
  return { user, agent };
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function notFound(msg = 'Not found') {
  return NextResponse.json({ error: msg }, { status: 404 });
}

/**
 * Handle auth/notfound errors from requireUser/requireAgentAccess.
 */
export function handleAuthError(err: unknown): NextResponse {
  if (err instanceof AuthError) return unauthorized();
  if (err instanceof NotFoundError) return notFound(err.message);
  throw err;
}

export { COOKIE_NAME };
