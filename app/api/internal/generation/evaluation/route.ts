import { NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { decodeFrozenArmRequest, executeFrozenArmEnvelope, EvaluationRequestError } from '@/lib/astra-evaluation-remote';

export const runtime = 'nodejs';
export const maxDuration = 800;

export async function POST(request: Request) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) return NextResponse.json({ error: authError.message }, { status: authError.status });
  const expectedCommit = request.headers.get('x-evaluation-commit');
  if (expectedCommit && expectedCommit !== process.env.VERCEL_GIT_COMMIT_SHA) return NextResponse.json({ error: 'Evaluation deployment changed.' },
    { status: 409, headers: { 'Cache-Control': 'no-store' } });
  try {
    const envelope = await decodeFrozenArmRequest(request);
    const result = await executeFrozenArmEnvelope(envelope);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof EvaluationRequestError ? error.message : 'Frozen evaluation execution failed.' },
      { status: error instanceof EvaluationRequestError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
