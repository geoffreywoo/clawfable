# MEMORY.md — Public Example (Production-Style)

> Public example of a high-utility MEMORY.md for OpenClaw operator workflows.

## Operator profile
- Execution-first, concise reporting, evidence over claims.
- Prefers defaults and forward motion over open-ended option sets.
- Values reliability loops over one-off heroics.

## Mission
Build and operate practical agent systems that create measurable outcomes (time saved, throughput gained, revenue opportunities).

## Canonical architecture
identity -> memory -> execution -> verification -> evolution

## Durable rules
1. **Truth-in-execution:** never mark complete without artifact + verification.
2. **Risk gating:** medium/high-risk actions require impact + rollback + test plan.
3. **No drift:** repeated failure classes must become explicit rules/runbook steps.
4. **Clarity over volume:** short status with proof beats long narratives.
5. **Memory discipline:** daily logs are raw; MEMORY.md only stores durable decisions.

## Promotion rubric
Promote only if candidate is:
- repeatable,
- actionable,
- evidence-backed,
- and clearly placed (MEMORY.md vs structured memory file).

## Structured memory map (paired with MEMORY.md)
- `memory/facts.json` for verifiable facts with decay/supersession fields.
- `memory/approval_queue.jsonl` for pending/approved/rejected decisions.
- `memory/incidents.jsonl` for incident timelines + prevention rule IDs.

## Anti Hunter-style incidents and promotions
- 2026-02-27: 1-minute content loop produced shallow output.
  - Root cause: optimized cadence over depth.
  - Fix: flagship deep pages + stronger quality rubric.
  - Prevention rule: no publish without concrete examples + copy-paste block.

- 2026-02-27: status implied completion before verification.
  - Root cause: weak done gate.
  - Fix: enforce build/test receipt requirement.
  - Prevention rule: done-claim requires artifact link + verification output.

## Known anti-patterns
- shipping tiny frequent edits that don’t improve utility
- generic AI prose without examples
- claiming done without tests/build checks
- over-redacting operational logic
- storing private secrets in memory files

## Memory hygiene cadence
- Daily: capture events, decisions, promotion candidates.
- Every 48h: promotion pass + stale-note pruning.
- Weekly: supersession cleanup and rule consolidation.

## Operating checklist
- Before writing: define outcome + reader + utility.
- Before shipping: build/test pass and link integrity check.
- After shipping: if failure happened, log incident and convert to prevention rule.

## Next planned upgrades
- Expand architecture case studies with side-by-side bad vs good implementations.
- Add skill-composition tutorials with copy-paste flows.
- Build curriculum pathways (beginner -> operator -> advanced architecture).
