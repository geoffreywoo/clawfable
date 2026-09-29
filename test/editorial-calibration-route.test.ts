import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const run = vi.hoisted(() => vi.fn());
vi.mock('../lib/editorial-text-calibration', () => ({ runTextCalibrationStage: run }));
import { POST } from '../app/api/internal/agents/[id]/generation/calibration/route';

describe('authenticated calibration execution', () => {
  const hash = 'a'.repeat(64);
  const request = (body: unknown, authorized = true) => new NextRequest('https://example.com/api/internal/agents/13/generation/calibration', {
    method: 'POST', headers: authorized ? { authorization: 'Bearer test-secret' } : {}, body: JSON.stringify(body),
  });
  const params = (id = '13') => ({ params: Promise.resolve({ id }) });
  beforeEach(() => { process.env.CRON_SECRET = 'test-secret'; run.mockReset(); });
  it('never runs paid work without authentication or for another account', async () => {
    expect((await POST(request({ projectionHash: hash, stage: 'candidate' }, false), params())).status).toBe(401);
    expect((await POST(request({ projectionHash: hash, stage: 'candidate' }), params('14'))).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects caller budgets, prompts, models and invalid stages', async () => {
    for (const body of [{ projectionHash: hash, stage: 'candidate', budget: 100 }, { projectionHash: hash, stage: 'publish' }, { projectionHash: 'bad', stage: 'candidate' }])
      expect((await POST(request(body), params())).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('returns a receipt without private prompts or draft text', async () => {
    run.mockResolvedValue({ requestKey: 'key', assessments: [{ id: 'one' }], result: { model: 'judge', text: 'PRIVATE COPY', inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.01 } });
    const response = await POST(request({ projectionHash: hash, stage: 'candidate' }), params());
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(hash, 'candidate');
    const receipt = await response.json();
    expect(receipt.assessed).toBe(1);
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE COPY');
  });
  it('keeps malformed paid output pending and redacts provider errors', async () => {
    run.mockResolvedValue({ requestKey: 'key', assessments: null, result: { model: 'judge' } });
    expect((await (await POST(request({ projectionHash: hash, stage: 'candidate' }), params())).json()).pending).toBe(true);
    run.mockRejectedValue(new Error('secret provider detail'));
    expect(await (await POST(request({ projectionHash: hash, stage: 'candidate' }), params())).json()).toEqual({ error: 'calibration_failed' });
  });
});
