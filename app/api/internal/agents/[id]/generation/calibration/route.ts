import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { runTextCalibrationStage } from '@/lib/editorial-text-calibration';

export const maxDuration = 240;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) return NextResponse.json({ error: authError.message }, { status: authError.status });
  if ((await params).id !== '13') return NextResponse.json({ error: 'account_not_enabled' }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || !/^[a-f0-9]{64}$/.test(body.projectionHash) || !['candidate', 'baseline', 'reconcile'].includes(body.stage)
    || Object.keys(body).some(key => !['projectionHash', 'stage'].includes(key)))
    return NextResponse.json({ error: 'invalid_calibration_request' }, { status: 400 });
  try {
    const value = await runTextCalibrationStage(body.projectionHash, body.stage);
    if (body.stage === 'reconcile') return NextResponse.json({ stage: body.stage, reconciliation: value.reconciliation }, { headers: { 'Cache-Control': 'private, no-store' } });
    return NextResponse.json({ stage: body.stage, requestKey: value.requestKey, model: value.result.model,
      assessed: value.assessments?.length ?? null, pending: body.stage === 'candidate' && !value.assessments,
      complete: value.complete ?? body.stage === 'baseline', completedBatches: value.completedBatches, totalBatches: value.totalBatches,
      inputTokens: value.result.inputTokens, outputTokens: value.result.outputTokens,
      estimatedCostUsd: value.result.estimatedCostUsd }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'calibration_failed';
    const safe = ['budget_exhausted', 'budget_unavailable', 'provider_pending', 'active_policy_changed',
      'text_calibration_projection_missing', 'candidate_assessment_pending'].includes(code) ? code : 'calibration_failed';
    return NextResponse.json({ error: safe }, { status: 409 });
  }
}
