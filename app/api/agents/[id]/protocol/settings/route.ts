import { NextRequest, NextResponse } from 'next/server';
import { getProtocolSettings, updateProtocolSettings, getPostLog, getAnalysis, saveBaseline } from '@/lib/kv-storage';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getBillingSummary } from '@/lib/billing';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse, getAgentAutomationEntitlement } from '@/lib/automation-entitlement';
import { readJsonObjectBody, validateProtocolSettingsPatch } from '@/lib/request-validation';

// GET /api/agents/[id]/protocol/settings
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { user, agent } = await requireAgentAccess(id);
    const settings = await getProtocolSettings(id);
    const postLog = await getPostLog(id, 10);
    const agentCount = await getAccessibleAgentCount(user);
    const automationEntitlement = await getAgentAutomationEntitlement(id, { agent, user });
    return NextResponse.json({ settings, postLog, billing: getBillingSummary(user, agentCount), automationEntitlement });
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
    const { user, agent } = await requireAgentAccess(id);
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
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
      || updates.earlyVelocityFollowups === true
      || updates.supervisedTrendDesk === true
      || updates.relationshipQueueEnabled === true
      || updates.portfolioOptimizerEnabled === true
      || updates.marketingEnabled === true
    );
    if (isTryingToEnableAutomation) {
      await assertAgentAutomationEntitlement(id, { agent, user });
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
    if (err instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(err), { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
