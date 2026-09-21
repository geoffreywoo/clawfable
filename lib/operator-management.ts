/** Accounts whose cadence is owned by a trusted external operator, not Vercel cron. */
export const OPERATOR_MANAGED_AUTOPILOT_REASON = 'This account is managed by its existing operator; use that publishing workflow.';

export function isOperatorManagedAgent(agentId: string): boolean {
  return (process.env.CLAWFABLE_OPERATOR_MANAGED_AGENT_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean).includes(String(agentId));
}
