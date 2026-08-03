import { getPaidAutomationEntitlementForUser } from './billing';
import { getAgent, getAgentOwnerId, getUser } from './kv-storage';
import type { Agent, AutomationEntitlement, User } from './types';

export const PAYMENT_REQUIRED_CODE = 'payment_required';

export class AutomationEntitlementError extends Error {
  readonly code = PAYMENT_REQUIRED_CODE;
  readonly status = 402;
  readonly entitlement: AutomationEntitlement;

  constructor(entitlement: AutomationEntitlement) {
    super(entitlement.reason);
    this.name = 'AutomationEntitlementError';
    this.entitlement = entitlement;
  }
}

export function getAutomationExemptAgentIds(): string[] {
  return [...new Set((process.env.AUTOMATION_EXEMPT_AGENT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean))];
}

function exemptAgentIds(): Set<string> {
  return new Set(getAutomationExemptAgentIds());
}

export function isAgentAutomationExempt(agentId: string): boolean {
  return exemptAgentIds().has(String(agentId));
}

function exemptEntitlement(): AutomationEntitlement {
  return {
    source: 'agent_exemption',
    eligible: true,
    reason: 'This exact agent is exempt from paid automation checks.',
    verifiedAt: new Date().toISOString(),
    paidThrough: null,
    paidInvoiceId: null,
    paidInvoiceSubscriptionId: null,
    paidAmountCents: null,
    paidCurrency: null,
  };
}

export async function getAgentAutomationEntitlement(
  agentId: string,
  options: { agent?: Agent | null; user?: User | null; now?: Date } = {},
): Promise<AutomationEntitlement> {
  const agent = options.agent === undefined ? await getAgent(agentId) : options.agent;
  if (!agent) return getPaidAutomationEntitlementForUser(null, options.now);
  const ownerId = await getAgentOwnerId(agentId);
  if (!ownerId) return getPaidAutomationEntitlementForUser(null, options.now);
  if (options.user && String(options.user.id) !== String(ownerId)) {
    return {
      ...getPaidAutomationEntitlementForUser(null, options.now),
      reason: 'The supplied billing user does not own this agent.',
    };
  }
  if (isAgentAutomationExempt(agentId)) return exemptEntitlement();
  const user = options.user === undefined ? await getUser(String(ownerId)) : options.user;
  return getPaidAutomationEntitlementForUser(user, options.now);
}

export async function assertAgentAutomationEntitlement(
  agentId: string,
  options: { agent?: Agent | null; user?: User | null; now?: Date } = {},
): Promise<AutomationEntitlement> {
  const entitlement = await getAgentAutomationEntitlement(agentId, options);
  if (!entitlement.eligible) throw new AutomationEntitlementError(entitlement);
  return entitlement;
}

export function entitlementErrorResponse(error: AutomationEntitlementError): {
  error: string;
  code: string;
  entitlement: AutomationEntitlement;
} {
  return {
    error: error.message,
    code: error.code,
    entitlement: error.entitlement,
  };
}
