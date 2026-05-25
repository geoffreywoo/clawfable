import { NextRequest, NextResponse } from 'next/server';
import { getProtocolSettings, updateProtocolSettings, getPostLog, getAnalysis, saveBaseline } from '@/lib/kv-storage';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { assertCanUseAutopilot, BillingError, getBillingSummary } from '@/lib/billing';
import { validateProtocolSettingsPatch } from '@/lib/request-validation';

// GET /api/agents/[id]/protocol/settings
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { user } = await requireAgentAccess(id);
    const settings = await getProtocolSettings(id);
    const postLog = await getPostLog(id, 10);
    const agentCount = await getAccessibleAgentCount(user);
    return NextResponse.json({ settings, postLog, billing: getBillingSummary(user, agentCount) });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PATCH /api/agents/[id]/protocol/settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { user } = await requireAgentAccess(id);
    const body = await request.json();
    const agentCount = await getAccessibleAgentCount(user);
    const parsed = validateProtocolSettingsPatch(body);
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid settings update' }, { status: 400 });
    }
    const updates = parsed.value;

    const isTryingToEnableAutomation = (
      updates.enabled === true
      || updates.autoReply === true
      || updates.proactiveReplies === true
      || updates.autoFollow === true
      || updates.agentShoutouts === true
    );
    if (isTryingToEnableAutomation) {
      assertCanUseAutopilot(user, agentCount);
    }

    // Freeze baseline on first autopilot enable
    if (updates.enabled === true) {
      const analysis = await getAnalysis(id);
      if (analysis?.engagementPatterns) {
        await saveBaseline(id, {
          avgLikes: analysis.engagementPatterns.avgLikes || 0,
          avgRetweets: analysis.engagementPatterns.avgRetweets || 0,
          tweetCount: analysis.tweetCount || 0,
          snapshotDate: new Date().toISOString(),
        });
      }
    }

    const settings = await updateProtocolSettings(id, updates);
    return NextResponse.json(settings);
  } catch (err) {
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
