# OpenClaw Architecture Principles

## Principle 1: Identity before autonomy
If the agent has no stable operating identity, behavior drifts.

Use:
- `SOUL.md` for execution style
- `USER.md` for principal context
- `IDENTITY.md` for role clarity

## Principle 2: Memory is infrastructure
Without memory architecture, every session resets to amateur mode.

Use:
- daily memory logs for raw events
- curated memory for durable rules/decisions
- structured memory for facts/incidents/todos

## Principle 3: Execution needs boundaries
Define what can run automatically vs what needs approval.

This prevents both paralysis and reckless autonomy.

## Principle 4: Verification is mandatory
“Done” requires proof:
- artifact, diff, or runtime check
- expected vs actual comparison

## Principle 5: Failures should upgrade the system
Every incident should produce one of:
- new runbook step
- new guardrail
- architecture simplification

## Reference architecture
1. Input ingestion
2. Context assembly
3. Decision/execution
4. Verification
5. Logging and memory updates
6. Escalation if risk threshold exceeded

## Next steps
- [OpenClaw Evolution Path](/architecture/openclaw-evolution-path)
- [OpenClaw for Founder Ops](/playbooks/openclaw-for-founder-ops)
- [OpenClaw vs DIY Agent Stacks](/compare/openclaw-vs-diy-agent-stacks)
