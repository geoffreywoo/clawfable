import { describe, expect, it, vi } from 'vitest';
import { createAgent, createEngagementSession } from '@/lib/kv-storage';

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    requireAgentAccess: vi.fn(async (id: string) => ({
      user: { id: 'user-1', handle: 'operator', name: 'Operator' },
      agent: {
        id,
        handle: 'guard-agent',
        name: 'Guard Agent',
        soulMd: '# soul',
        setupStep: 'oauth',
        isConnected: 0,
      },
    })),
    handleAuthError: vi.fn((err: unknown) => {
      throw err;
    }),
  };
});

vi.mock('@/lib/automation-entitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement');
  return {
    ...actual,
    assertAgentAutomationEntitlement: vi.fn(async () => ({
      source: 'agent_exemption',
      eligible: true,
      reason: 'test exemption',
      verifiedAt: new Date().toISOString(),
      paidThrough: null,
      paidInvoiceId: null,
      paidAmountCents: null,
      paidCurrency: null,
    })),
  };
});

import { POST as connectPost } from '@/app/api/agents/[id]/connect/route';
import { POST as voiceChatPost } from '@/app/api/agents/[id]/voice-chat/route';
import { POST as generateReplyPost } from '@/app/api/agents/[id]/generate-reply/route';
import { POST as learningSignalPost } from '@/app/api/agents/[id]/learning-signal/route';
import { POST as resolveTargetPost } from '@/app/api/agents/[id]/engage/resolve-target/route';
import { POST as draftReplyPost } from '@/app/api/agents/[id]/engage/draft-reply/route';
import { POST as wizardPost } from '@/app/api/agents/[id]/wizard/route';
import { PATCH as manualExamplesPatch } from '@/app/api/agents/[id]/learning/manual-examples/route';
import { PATCH as protocolSettingsPatch } from '@/app/api/agents/[id]/protocol/settings/route';
import { PATCH as engageSessionPatch } from '@/app/api/agents/[id]/engage/sessions/[sessionId]/route';
import { POST as twitterOauthPost } from '@/app/api/auth/twitter/route';
import { POST as pairingCompletePost } from '@/app/api/browser-companion/pairings/complete/route';

function jsonRequest(body: string, method = 'POST'): Request {
  return new Request('http://localhost/api/guard', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

async function expectInvalidJsonBody(response: Response) {
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe('Invalid JSON body');
}

describe('mutation routes reject malformed JSON bodies with 400', () => {
  it('guards POST /api/agents/[id]/connect', async () => {
    await expectInvalidJsonBody(await connectPost(
      jsonRequest('{') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards POST /api/agents/[id]/voice-chat', async () => {
    await expectInvalidJsonBody(await voiceChatPost(
      jsonRequest('not json') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards POST /api/agents/[id]/generate-reply', async () => {
    await expectInvalidJsonBody(await generateReplyPost(
      jsonRequest('{"content":') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards POST /api/agents/[id]/learning-signal', async () => {
    await expectInvalidJsonBody(await learningSignalPost(
      jsonRequest('{') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards POST /api/agents/[id]/engage/resolve-target', async () => {
    await expectInvalidJsonBody(await resolveTargetPost(
      jsonRequest('{') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards POST /api/agents/[id]/engage/draft-reply', async () => {
    await expectInvalidJsonBody(await draftReplyPost(
      jsonRequest('{') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards POST /api/agents/[id]/wizard', async () => {
    const agent = await createAgent({ handle: 'guard-wizard', name: 'Guard Agent', soulMd: '# soul' } as any);
    await expectInvalidJsonBody(await wizardPost(
      jsonRequest('{') as any,
      { params: Promise.resolve({ id: agent.id }) },
    ));
  });

  it('guards PATCH /api/agents/[id]/learning/manual-examples', async () => {
    await expectInvalidJsonBody(await manualExamplesPatch(
      jsonRequest('{', 'PATCH') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards PATCH /api/agents/[id]/protocol/settings', async () => {
    await expectInvalidJsonBody(await protocolSettingsPatch(
      jsonRequest('{', 'PATCH') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });

  it('guards PATCH /api/agents/[id]/engage/sessions/[sessionId]', async () => {
    const agent = await createAgent({ handle: 'guard-session', name: 'Guard Agent', soulMd: '# soul' } as any);
    const session = await createEngagementSession({
      agentId: agent.id,
      state: 'draft',
      actions: [],
    } as any);
    await expectInvalidJsonBody(await engageSessionPatch(
      jsonRequest('{', 'PATCH') as any,
      { params: Promise.resolve({ id: agent.id, sessionId: session.id }) },
    ));
  });

  it('guards POST /api/auth/twitter', async () => {
    await expectInvalidJsonBody(await twitterOauthPost(jsonRequest('{') as any));
  });

  it('guards POST /api/browser-companion/pairings/complete', async () => {
    await expectInvalidJsonBody(await pairingCompletePost(jsonRequest('{') as any));
  });

  it('rejects a well-formed JSON body that is not an object', async () => {
    await expectInvalidJsonBody(await learningSignalPost(
      jsonRequest('[1,2,3]') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
    await expectInvalidJsonBody(await resolveTargetPost(
      jsonRequest('"just a string"') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    ));
  });
});
