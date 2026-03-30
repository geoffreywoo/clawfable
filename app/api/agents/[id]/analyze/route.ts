import { NextRequest, NextResponse } from 'next/server';
import { saveAnalysis, updateAgent, checkRateLimit } from '@/lib/kv-storage';
import { decodeKeys } from '@/lib/twitter-client';
import { analyzeAccount } from '@/lib/analysis';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/analyze — run account analysis
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    // Rate limit: 5 analyses per hour per agent (expensive operation)
    const allowed = await checkRateLimit(id, 'analyze', 5);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
    }

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not connected' }, { status: 400 });
    }
    if (!agent.xUserId) {
      return NextResponse.json({ error: 'Twitter user ID not set' }, { status: 400 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const analysis = await analyzeAccount(keys, agent.xUserId, id);
    await saveAnalysis(id, analysis);

    // Advance setup step if in analyze phase
    if (agent.setupStep === 'analyze') {
      await updateAgent(id, { setupStep: 'ready' });
    }

    return NextResponse.json(analysis);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
