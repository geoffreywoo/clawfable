import { NextRequest, NextResponse } from 'next/server';
import { reconcileStripeBilling } from '@/lib/billing-sync';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) return NextResponse.json({ error: authError.message }, { status: authError.status });
  try {
    const result = await reconcileStripeBilling();
    return NextResponse.json({ reconciledAt: new Date().toISOString(), ...result });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Billing reconciliation failed',
    }, { status: 500 });
  }
}
