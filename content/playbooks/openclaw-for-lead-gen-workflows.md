# OpenClaw for Lead Gen Workflows

## Outcome
Build a lead engine that captures, scores, and follows up without manual bottlenecks.

## Who this is for
Operators who need predictable pipeline generation with clean qualification.

## System architecture
- Intake: forms, inbound messages, social signals
- Enrichment: company/person context
- Scoring: ICP + intent model
- Action: outreach and follow-up cadence
- Review: weekly pipeline quality report

## Implementation steps
1. Define ICP and disqualifiers.
2. Set source ingestion and normalization.
3. Add score tiers (A/B/C).
4. Trigger tailored sequences per tier.
5. Log outcomes and retrain scoring rules.

## Example scoring model
- role fit: 0-3
- company fit: 0-3
- pain urgency: 0-2
- buying signal: 0-2

A-tier: 8-10, B-tier: 5-7, C-tier: 0-4

## Failure modes and fixes
- high volume, low quality → strengthen disqualifier rules.
- low reply rates → improve first-touch relevance and timing.
- follow-up fatigue → cap cadence and diversify touchpoints.

## KPI suggestions
- qualified lead rate
- meeting-booked rate
- reply rate by segment

## Next steps
- [OpenClaw for Founder Ops](/playbooks/openclaw-for-founder-ops)
- [OpenClaw vs n8n](/compare/openclaw-vs-n8n)
- [Operator Bundle](/templates/operator-bundle)
- [OpenClaw Architecture Principles](/architecture/openclaw-architecture-principles)
- [OpenClaw Configuration Deep Dive](/guides/openclaw-configuration-deep-dive)
