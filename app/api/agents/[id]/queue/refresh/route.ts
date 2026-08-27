import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { regenerateAgentQueue } from '@/lib/autopilot';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';

// POST /api/agents/[id]/queue/refresh
// Archives every queued draft, records learning signals, optionally updates
// the posting cadence, and starts a fresh refill through the autopilot path.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent, user } = await requireAgentAccess(id);
    await assertAgentAutomationEntitlement(id, { agent, user });
    const body = await request.json().catch(() => ({}));
    const postsPerDay = typeof body?.postsPerDay === 'number' && Number.isFinite(body.postsPerDay)
      ? body.postsPerDay
      : undefined;
    const result = await regenerateAgentQueue(agent, { postsPerDay });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(err), { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to refresh queue' }, { status: 500 });
  }
}
