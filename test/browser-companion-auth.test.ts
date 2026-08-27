import { describe, expect, it } from 'vitest';
import { requireBrowserCompanionPairing } from '@/lib/browser-companion';
import {
  createBrowserCompanionPairing,
  getOrCreateUser,
  updateBrowserCompanionPairing,
} from '@/lib/kv-storage';

describe('browser companion auth', () => {
  it('rejects expired pairings', async () => {
    const user = await getOrCreateUser('pairing-user-expired', 'pairingexpired', 'Pairing Expired');
    const pairing = await createBrowserCompanionPairing(user.id, 'Expired laptop');

    const validRequest = new Request('http://localhost/api/browser-companion/actions/next', {
      headers: {
        Authorization: `Bearer ${pairing.token}`,
      },
    });
    await expect(requireBrowserCompanionPairing(validRequest as any)).resolves.toMatchObject({
      id: pairing.id,
      ownerUserId: user.id,
    });

    await updateBrowserCompanionPairing(pairing.id, {
      expiresAt: '2000-01-01T00:00:00.000Z',
    });

    await expect(requireBrowserCompanionPairing(validRequest as any)).rejects.toThrow('Invalid browser companion token');
  });
});
