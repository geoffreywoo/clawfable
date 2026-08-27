import { NextRequest } from 'next/server';
import { getBrowserCompanionPairingByToken, updateBrowserCompanionPairing } from './kv-storage';
import type { BrowserCompanionPairing } from './types';

export const BROWSER_COMPANION_AUTH_SCHEME = 'Bearer';

export class BrowserCompanionAuthError extends Error {
  constructor(message = 'Invalid browser companion token') {
    super(message);
  }
}

function readBearerToken(request: NextRequest): string | null {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith(`${BROWSER_COMPANION_AUTH_SCHEME} `)) {
    return null;
  }

  const token = auth.slice(BROWSER_COMPANION_AUTH_SCHEME.length + 1).trim();
  return token || null;
}

function pairingExpired(pairing: BrowserCompanionPairing): boolean {
  return !!pairing.expiresAt && new Date(pairing.expiresAt).getTime() <= Date.now();
}

export async function requireBrowserCompanionPairing(request: NextRequest): Promise<BrowserCompanionPairing> {
  const token = readBearerToken(request);
  if (!token) {
    throw new BrowserCompanionAuthError('Missing browser companion token');
  }

  const pairing = await getBrowserCompanionPairingByToken(token);
  if (!pairing || pairing.status !== 'active' || pairingExpired(pairing)) {
    throw new BrowserCompanionAuthError();
  }

  return updateBrowserCompanionPairing(pairing.id, {
    lastHeartbeatAt: new Date().toISOString(),
  });
}
