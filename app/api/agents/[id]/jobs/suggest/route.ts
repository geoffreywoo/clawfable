import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis, getJobs } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { generateJobSuggestions } from '@/lib/job-suggestions';

// GET /api/agents/[id]/jobs/suggest
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ suggestions: [], reason: 'No account analysis — run analysis first' });
    }

    const activeJobs = await getJobs(id);
    const suggestions = generateJobSuggestions(analysis, activeJobs);
    return NextResponse.json({ suggestions });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 });
  }
}
