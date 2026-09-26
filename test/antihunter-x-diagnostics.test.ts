import { describe, expect, it } from 'vitest';
import { operatorXFailure } from '../lib/antihunter-x-diagnostics';
describe('private operator X failure diagnostics', () => {
  it('drops echoed values, free text, arbitrary keys and credential material', () => {
    const result = operatorXFailure({ code: 400, headers: { authorization: 'SECRET' },
      data: { title: 'SECRET', detail: 'SECRET', type: 'https://evil/SECRET', errors: [
        { parameter: 'reply.in_reply_to_tweet_id', value: 'SECRET', message: 'SECRET' },
        { parameters: { text: ['SECRET'], SECRET: 'SECRET', access_token: 'SECRET' } },
        { parameter: 'text' }, { parameter: 'SECRET' }, null,
      ] } }, 'response');
    expect(result).toEqual({ kind: 'response', status: 400, parameters: ['reply.in_reply_to_tweet_id', 'text'] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('does not interpret transport errors or malformed statuses as provider rejection', () => {
    expect(operatorXFailure({ code: 400, data: { errors: [{ parameter: 'text' }] } }, 'transport'))
      .toEqual({ kind: 'transport', parameters: [] });
    for (const error of [null, 'secret', {}, { code: '400' }, { code: 32 }, { code: 999 }, { data: { errors: {} } }])
      expect(operatorXFailure(error, 'response')).toEqual({ kind: 'response', parameters: [] });
  });
  it('bounds provider error scanning and keeps generic HTTP failures useful', () => {
    expect(operatorXFailure({ code: 503 }, 'response')).toEqual({ kind: 'response', status: 503, parameters: [] });
    expect(operatorXFailure({ code: 400, data: { errors: [...Array(20).fill({}), { parameter: 'text' }] } }, 'response').parameters).toEqual([]);
  });
});
