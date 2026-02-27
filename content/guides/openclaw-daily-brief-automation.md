# OpenClaw Daily Brief Automation

## Outcome
Get a concise daily operator brief with priorities, blockers, and next actions.

## Brief structure
- Priority tasks (top 3)
- Critical inbox/calendar events
- Risk flags
- Suggested actions

## Implementation steps
1. Define morning brief schema.
2. Connect sources (calendar, inbox, channel mentions).
3. Add ranking logic for importance.
4. Schedule delivery and acknowledgement flow.

## Failure modes and fixes
- Too long → enforce strict token/length caps.
- Low signal → improve relevance scoring.
- Missed critical items → add hard-priority rules.

## Artifact
Daily brief template + ranking rubric.

## Next step
- `/playbooks/openclaw-for-founder-ops`
- `/templates/daily-brief-template-pack`
