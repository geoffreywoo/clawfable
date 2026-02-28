# Memory Promotion Protocol v1

## Goal
Convert raw daily logs into durable memory rules.

## Copy-paste sources
- Core MEMORY template: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/MEMORY.md>
- Public full example: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/examples/MEMORY.public-example.md>

## Apply steps
1. Read last 24h daily memory file.
2. Extract repeated failure/win patterns.
3. Promote only durable rules to `MEMORY.md`.
4. Append incident JSONL if failure occurred.

## Validation
- MEMORY has actionable rules, not diary noise
- repeated failure class has explicit prevention rule
