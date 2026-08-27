import { NextRequest, NextResponse } from 'next/server';
import { requireUser, handleAuthError } from '@/lib/auth';
import { BROWSER_COMPANION_LOCAL_URL } from '@/lib/engagement';
import { createBrowserCompanionPairingChallenge } from '@/lib/kv-storage';

// POST /api/browser-companion/pairings
export async function POST(_request: NextRequest) {
  try {
    const user = await requireUser();
    const challenge = await createBrowserCompanionPairingChallenge(user.id);

    return NextResponse.json({
      challenge: challenge.challenge,
      createdAt: challenge.createdAt,
      expiresAt: challenge.expiresAt,
      localUrl: BROWSER_COMPANION_LOCAL_URL,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to create pairing challenge';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
