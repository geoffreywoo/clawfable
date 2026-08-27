import { NextRequest, NextResponse } from 'next/server';
import { buildGenerationQualityAudit } from '@/lib/generation-quality-audit';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgent, resetReadCache } from '@/lib/kv-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  resetReadCache();
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const audit = await buildGenerationQualityAudit(agent);
  return NextResponse.json(audit, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
