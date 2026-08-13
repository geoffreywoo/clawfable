import { NextRequest, NextResponse } from 'next/server';
import {
  AgentIdentityReconciliationError,
  reconcileAgentXIdentity,
} from '@/lib/agent-identity';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import {
  AgentHandleConflictError,
  getAgent,
  resetReadCache,
} from '@/lib/kv-storage';

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
    const result = await reconcileAgentXIdentity(agent);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof AgentIdentityReconciliationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof AgentHandleConflictError) {
      return NextResponse.json({
        error: error.message,
        code: 'x_handle_conflict',
        duplicateAgentId: error.existingAgentId,
      }, { status: 409 });
    }
    return NextResponse.json({
      error: 'Unable to verify the connected account with the official X API.',
      code: 'x_identity_lookup_failed',
    }, { status: 502 });
  }
}
