# OpenClaw for Lead Gen Workflows

## Outcome
Build a repeatable outbound + inbound lead system with qualification and follow-up automation.

## System design
- Input sources: website forms, LinkedIn signals, inbound DMs
- Qualification layer: ICP scoring + disqualifier rules
- Action layer: personalized outreach + follow-up cadences
- Review layer: weekly conversion report

## Implementation steps
1. Define ICP scorecard (industry, role, budget, urgency).
2. Set ingestion connectors for lead sources.
3. Add enrichment and scoring logic.
4. Trigger outreach sequences based on score tier.
5. Log outcomes for weekly optimization.

## Failure modes and fixes
- Low reply rates → tighten ICP + rewrite first-touch message.
- High unqualified volume → raise scoring threshold.
- Sequence fatigue → cap follow-up count and vary channels.

## Artifact
Lead qualification schema + follow-up SOP.

## Next step
- `/templates/lead-gen-skill-pack`
- `/compare/openclaw-vs-diy-agent-stacks`
