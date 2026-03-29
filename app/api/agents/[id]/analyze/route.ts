import { NextRequest, NextResponse } from 'next/server';
import { getAgent, saveAnalysis, updateAgent } from '@/lib/kv-storage';
import { decodeKeys } from '@/lib/twitter-client';
import { analyzeAccount } from '@/lib/analysis';

// POST /api/agents/[id]/analyze — run account analysis
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

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
    const message = err instanceof Error ? err.message : 'Analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
