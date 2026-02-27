# OpenClaw for Founder Ops

## Outcome
Run a daily execution loop that prioritizes the right work, surfaces blockers early, and compresses decision latency.

## Who this is for
Founders handling strategy + execution who need structured leverage.

## System architecture
- Inputs: inbox, calendar, key channels, project docs
- Agent loop: collect → rank → propose → execute → report
- Outputs: daily brief, action queue, follow-up log

## Implementation steps
1. Define your daily briefing schema.
2. Create priority rubric (impact, urgency, reversibility).
3. Connect communication channels.
4. Set execution boundaries (what can be done autonomously).
5. Add end-of-day review and carry-forward list.

## Daily briefing schema (example)
```md
# Daily Brief
Top 3 priorities:
Critical meetings/events:
Blocking risks:
Recommended actions:
Pending approvals:
```

## Failure modes and fixes
- Too much low-value noise → tighten ranking thresholds.
- Execution drift → enforce explicit daily outcome definition.
- Missed high-risk actions → hard-gate external actions to approval.

## KPI suggestions
- % top-3 priorities completed
- response latency on critical tasks
- number of unresolved blockers >24h

## Next steps
- [OpenClaw Daily Brief Automation](/guides/openclaw-daily-brief-automation)
- [Founder Ops Template Pack](/templates/founder-ops-template-pack)
- [OpenClaw Configuration Deep Dive](/guides/openclaw-configuration-deep-dive)
