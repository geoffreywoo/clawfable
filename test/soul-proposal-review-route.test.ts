import { describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  getAgent,
  getPostLog,
  getProtocolSettings,
  getSoulVersions,
  pushSoulVersion,
  updateProtocolSettings,
} from '@/lib/kv-storage';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => {
    const { getAgent: loadAgent } = await import('@/lib/kv-storage');
    const agent = await loadAgent(id);
    if (!agent) throw new Error('Agent not found');
    return { user: { id: 'user-1' }, agent };
  }),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

import { POST } from '@/app/api/agents/[id]/soul-evolution/route';
import { diffSoulLines, resolveSoulEvolutionState, SOUL_PROPOSAL_REVIEW_WINDOW_MS } from '@/lib/soul-evolution';

const CURRENT_SOUL = `# SOUL.md

I write from the support queue, not from theory.

## 1) Objective Function
Primary objective: Ship one concrete observation a day.`;

const PROPOSED_SOUL = `# SOUL.md

I write from the support queue, not from theory.

## 1) Objective Function
Primary objective: Ship one concrete observation a day.

## 2) Anti-goals
Never open with "most people don't realize".`;

async function makeAgentWithProposal(handle: string) {
  const agent = await createAgent({
    handle,
    name: `Agent ${handle}`,
    soulMd: CURRENT_SOUL,
  } as any);
  await updateProtocolSettings(agent.id, { soulEvolutionMode: 'approval' });
  await pushSoulVersion(agent.id, PROPOSED_SOUL, 'PENDING: added an anti-goal for stock AI openers');
  return agent;
}

function decide(agentId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/agents/${agentId}/soul-evolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: agentId }) },
  );
}

describe('soul evolution proposal review route', () => {
  it('applies the proposal, records non-pending version history, and clears the pending state', async () => {
    const agent = await makeAgentWithProposal('soul-review-approve');

    const response = await decide(agent.id, { decision: 'approve' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('applied');
    expect(body.applied).toBe(true);
    expect(body.changeSummary).toBe('added an anti-goal for stock AI openers');
    expect(body.state.pendingProposal).toBeNull();

    const updated = await getAgent(agent.id);
    expect(updated?.soulMd).toBe(PROPOSED_SOUL);

    const settings = await getProtocolSettings(agent.id);
    expect(settings.lastEvolvedAt).toBeTruthy();

    const versions = await getSoulVersions(agent.id);
    const applied = versions.find((version) => version.soulMd === PROPOSED_SOUL && !version.reason.startsWith('PENDING:'));
    expect(applied?.reason).toBe('Approved by operator: added an anti-goal for stock AI openers');
    expect(versions.some((version) => version.soulMd === CURRENT_SOUL && version.reason.startsWith('Replaced by approved proposal'))).toBe(true);

    const log = await getPostLog(agent.id, 10);
    expect(log[0]).toMatchObject({
      format: 'soul_evolution',
      source: 'manual',
      content: 'Soul evolution approved: added an anti-goal for stock AI openers',
    });

    // The newest version is no longer the proposal, so nothing is pending.
    const state = resolveSoulEvolutionState({
      settings,
      versions,
      currentSoulMd: PROPOSED_SOUL,
    });
    expect(state.pendingProposal).toBeNull();
  });

  it('is idempotent: a second approve of a resolved proposal answers cleanly instead of failing', async () => {
    const agent = await makeAgentWithProposal('soul-review-approve-twice');

    const first = await decide(agent.id, { decision: 'approve' });
    expect((await first.json()).status).toBe('applied');

    const second = await decide(agent.id, { decision: 'approve' });
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.status).toBe('no_pending_proposal');
    expect(body.applied).toBe(false);
    expect(body.version).toBeNull();

    const versionsAfter = await getSoulVersions(agent.id);
    expect(versionsAfter.filter((version) => version.reason.startsWith('Approved by operator:'))).toHaveLength(1);

    const third = await decide(agent.id, { decision: 'dismiss' });
    expect(third.status).toBe(200);
    expect((await third.json()).status).toBe('no_pending_proposal');
  });

  it('dismisses the proposal, keeps the current soul, and records why', async () => {
    const agent = await makeAgentWithProposal('soul-review-dismiss');

    const response = await decide(agent.id, { decision: 'dismiss', reason: 'not my voice' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('dismissed');
    expect(body.applied).toBe(false);
    expect(body.reason).toBe('not my voice');
    expect(body.state.pendingProposal).toBeNull();

    const unchanged = await getAgent(agent.id);
    expect(unchanged?.soulMd).toBe(CURRENT_SOUL);

    const settings = await getProtocolSettings(agent.id);
    expect(settings.lastEvolvedAt).toBeFalsy();

    const versions = await getSoulVersions(agent.id);
    expect(versions[0].reason).toContain('Dismissed proposal v');
    expect(versions[0].reason).toContain('not my voice');
    expect(versions[0].soulMd).toBe(CURRENT_SOUL);

    const log = await getPostLog(agent.id, 10);
    expect(log[0]).toMatchObject({ format: 'soul_evolution', action: 'skipped', reason: 'not my voice' });

    const secondDismiss = await decide(agent.id, { decision: 'dismiss' });
    expect(secondDismiss.status).toBe(200);
    expect((await secondDismiss.json()).status).toBe('no_pending_proposal');
  });

  it('treats a lapsed proposal as nothing to decide', async () => {
    const agent = await makeAgentWithProposal('soul-review-lapsed');
    const versions = await getSoulVersions(agent.id);
    const lapsed = versions.map((version) => ({
      ...version,
      updatedAt: new Date(Date.now() - SOUL_PROPOSAL_REVIEW_WINDOW_MS - 60_000).toISOString(),
    }));

    expect(resolveSoulEvolutionState({
      settings: await getProtocolSettings(agent.id),
      versions: lapsed,
      currentSoulMd: CURRENT_SOUL,
    }).pendingProposal).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + SOUL_PROPOSAL_REVIEW_WINDOW_MS + 60_000));
    try {
      const response = await decide(agent.id, { decision: 'approve' });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.status).toBe('no_pending_proposal');
    } finally {
      vi.useRealTimers();
    }

    const stillCurrent = await getAgent(agent.id);
    expect(stillCurrent?.soulMd).toBe(CURRENT_SOUL);
  });

  it('rejects an unknown decision without touching the soul', async () => {
    const agent = await makeAgentWithProposal('soul-review-invalid');

    const response = await decide(agent.id, { decision: 'maybe' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('approve');

    const unchanged = await getAgent(agent.id);
    expect(unchanged?.soulMd).toBe(CURRENT_SOUL);
  });

  it('summarizes the proposal as a bounded added/dropped line diff', async () => {
    const diff = diffSoulLines(CURRENT_SOUL, PROPOSED_SOUL);
    expect(diff.added).toEqual(['## 2) Anti-goals', 'Never open with "most people don\'t realize".']);
    expect(diff.removed).toEqual([]);
    expect(diff.addedCount).toBe(2);
    expect(diff.removedCount).toBe(0);

    const wide = diffSoulLines(
      `# SOUL\n${Array.from({ length: 30 }, (_, i) => `old line ${i}`).join('\n')}`,
      `# SOUL\n${Array.from({ length: 30 }, (_, i) => `new line ${i}`).join('\n')}`,
    );
    expect(wide.addedCount).toBe(30);
    expect(wide.removedCount).toBe(30);
    expect(wide.added).toHaveLength(8);
    expect(wide.removed).toHaveLength(8);

    const agent = await makeAgentWithProposal('soul-review-diff');
    const state = resolveSoulEvolutionState({
      settings: await getProtocolSettings(agent.id),
      versions: await getSoulVersions(agent.id),
      currentSoulMd: CURRENT_SOUL,
    });
    expect(state.pendingProposal?.diff.added).toContain('## 2) Anti-goals');
  });
});
