import { NextRequest, NextResponse } from 'next/server';
import { PUBLISHING_V2_MODEL_STACK } from '@/lib/ai';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgent, resetReadCache } from '@/lib/kv-storage';
import { refreshAgentResearch } from '@/lib/research-pipeline';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';

export const maxDuration = 800;

export async function POST(
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
  try {
    await assertAgentAutomationEntitlement(id, { agent });
  } catch (error) {
    if (error instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(error), { status: error.status });
    }
    throw error;
  }

  const result = await refreshAgentResearch(agent, {
    force: true,
    modelStack: PUBLISHING_V2_MODEL_STACK,
  });
  return NextResponse.json(result, { status: result.busy ? 409 : 200 });
}
