import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { readJsonObjectBody } from '@/lib/request-validation';
import {
  getSoulEvolutionState,
  resolvePendingSoulProposal,
  type SoulProposalDecision,
} from '@/lib/soul-evolution';

const DECISIONS: SoulProposalDecision[] = ['approve', 'dismiss'];

// GET /api/agents/[id]/soul-evolution
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    return NextResponse.json(await getSoulEvolutionState(agent));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to read soul evolution state';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/agents/[id]/soul-evolution
// Applies or dismisses the proposal approval-mode soul evolution is holding.
// Idempotent: deciding on an already-resolved or lapsed proposal answers 200
// with status 'no_pending_proposal' rather than failing.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const body = await readJsonObjectBody(request);
    if (!body.ok || !body.value) {
      return NextResponse.json({ error: body.error || 'Invalid JSON body' }, { status: 400 });
    }

    const decision = body.value.decision;
    if (typeof decision !== 'string' || !DECISIONS.includes(decision as SoulProposalDecision)) {
      return NextResponse.json({ error: 'Decision must be "approve" or "dismiss"' }, { status: 400 });
    }

    const reason = typeof body.value.reason === 'string' ? body.value.reason : undefined;
    const result = await resolvePendingSoulProposal(agent, decision as SoulProposalDecision, { reason });
    return NextResponse.json(result);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to resolve the voice change';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
