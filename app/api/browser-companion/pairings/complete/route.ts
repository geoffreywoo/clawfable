import { NextRequest, NextResponse } from 'next/server';
import {
  consumeBrowserCompanionPairingChallenge,
  createBrowserCompanionPairing,
} from '@/lib/kv-storage';

// POST /api/browser-companion/pairings/complete
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const challenge = typeof body?.challenge === 'string' ? body.challenge : '';
    const machineLabel = typeof body?.machineLabel === 'string' && body.machineLabel.trim()
      ? body.machineLabel.trim()
      : 'Local browser companion';

    if (!challenge) {
      return NextResponse.json({ error: 'challenge is required' }, { status: 400 });
    }

    const consumed = await consumeBrowserCompanionPairingChallenge(challenge);
    if (!consumed) {
      return NextResponse.json({ error: 'Pairing challenge is invalid or expired' }, { status: 400 });
    }

    const pairing = await createBrowserCompanionPairing(consumed.ownerUserId, machineLabel);
    return NextResponse.json({
      pairing,
      token: pairing.token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to complete pairing';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
