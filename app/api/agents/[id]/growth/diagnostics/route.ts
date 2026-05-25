import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import {
  getAutopilotLock,
  getCriticVerdicts,
  getIdeaAtoms,
  getMetricAvailability,
  getOutcomeEvents,
  getRelationshipProfiles,
} from '@/lib/kv-storage';

// GET /api/agents/[id]/growth/diagnostics — transparent learning/growth internals
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const [outcomes, metricAvailability, relationships, ideas, criticVerdicts, autopilotLock] = await Promise.all([
      getOutcomeEvents(id, 100),
      getMetricAvailability(id),
      getRelationshipProfiles(id, 100),
      getIdeaAtoms(id, 60),
      getCriticVerdicts(id, 100),
      getAutopilotLock(id),
    ]);

    return NextResponse.json({
      outcomes,
      metricAvailability,
      relationships,
      ideas,
      criticVerdicts,
      autopilotLock,
      summary: {
        outcomeEvents: outcomes.length,
        relationshipProfiles: relationships.length,
        ideaAtoms: ideas.length,
        reviewVerdicts: criticVerdicts.filter((item) => item.action === 'review').length,
        blockedVerdicts: criticVerdicts.filter((item) => item.action === 'block').length,
      },
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch growth diagnostics' }, { status: 500 });
  }
}
