# MEMORY.md - Long-Term Curated Memory

## Operating preferences
- concise status updates with proof
- execution speed without safety regression

## Durable rules
- truth-in-execution: no done-claim without artifact + verification
- ask before irreversible external actions
- repeated incidents must become explicit prevention rules

## Promotion rubric (daily -> MEMORY.md)
Promote only if all are true:
- repeatable within 30 days
- actionable behavior change
- evidence-backed (incident/win/result)
- too durable for daily logs

## Anti Hunter-style example promotions
- Incident: posted status before build verification.
  - Rule promoted: "no done-claim without build/test receipt."
- Incident: low-signal chatter in public channels.
  - Rule promoted: "publish only with proof or a concrete decision."

## Canonical architecture
identity -> memory -> execution -> verification -> evolution

## Memory hygiene protocol
- daily: capture events + promotion candidates in `memory/YYYY-MM-DD.md`
- every 48h: promote/prune candidates
- weekly: remove stale/outdated rules, add superseding rule when needed
- never store secrets/private identifiers in memory files

## Lessons learned
- YYYY-MM-DD — failure mode -> correction -> prevention rule
