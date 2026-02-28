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

## Concrete example (operator-grade)
```yaml
brief_date: 2026-02-27
priority_tasks:
  - ship onboarding docs refresh (owner: ops, eta: 2h)
  - close P1 bug in agent routing (owner: eng, eta: 4h)
  - confirm investor update send (owner: founder, eta: 30m)
risk_flags:
  - 'No backup owner assigned for support queue after 18:00 ET'
next_actions:
  - assign backup owner in #ops
  - post status note after bugfix deploy
```

Use this as a fixed schema contract. If a source cannot populate a required field, emit `unknown` instead of skipping keys so downstream automations stay stable.

## Failure modes and fixes
- Too long → enforce strict token/length caps.
- Low signal → improve relevance scoring.
- Missed critical items → add hard-priority rules.

## Artifact
Daily brief template + ranking rubric.

## Next step
- [OpenClaw for Founder Ops](/playbooks/openclaw-for-founder-ops)
- [OpenClaw Configuration Deep Dive](/guides/openclaw-configuration-deep-dive)
- [Founder Ops Template Pack](/templates/founder-ops-template-pack)
- [OpenClaw Learning Loops: Soul + Memory](/architecture/openclaw-learning-loops-soul-memory)
