import { describe, expect, it } from 'vitest';
import { decodeKeys } from '@/lib/twitter-client';

describe('twitter-client decodeKeys', () => {
  it('trims trailing newlines from decoded key material', () => {
    const decoded = decodeKeys({
      apiKey: Buffer.from('consumer-key\n').toString('base64'),
      apiSecret: Buffer.from('consumer-secret\n').toString('base64'),
      accessToken: Buffer.from('access-token').toString('base64'),
      accessSecret: Buffer.from('access-secret\n').toString('base64'),
    });

    expect(decoded).toEqual({
      appKey: 'consumer-key',
      appSecret: 'consumer-secret',
      accessToken: 'access-token',
      accessSecret: 'access-secret',
    });
  });
});
