import { NextRequest, NextResponse } from 'next/server';
import { updateAgent } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { decodeKeys } from '@/lib/twitter-client';
import { generateSoulFromTweets } from '@/lib/soul-from-tweets';
import { parseSoulMd } from '@/lib/soul-parser';

// POST /api/agents/[id]/generate-soul — generate SOUL.md from tweet history
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
      return NextResponse.json({ error: 'X API must be connected first' }, { status: 400 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const result = await generateSoulFromTweets(keys, agent.xUserId, agent.name);

    // Save the generated SOUL.md to the agent
    const voiceProfile = parseSoulMd(agent.name, result.soulMd);
    const updates: Record<string, unknown> = {
      soulMd: result.soulMd,
      soulSummary: voiceProfile.summary,
    };
    // Advance setup step past soul
    if (agent.setupStep === 'soul') {
      updates.setupStep = 'analyze';
    }
    await updateAgent(id, updates as Parameters<typeof updateAgent>[1]);

    return NextResponse.json(result);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate SOUL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
