---
title: "Self-Learning Loop Architecture v1"
description: "A full loop pattern for OpenClaw upgrades: planning, verification, incident capture, rule updates, and benchmark gates."
seoKeywords:
  - self learning loop
  - verification first
  - incident feedback loop
  - benchmark gate
copy_paste_scope:
  soul: true
  memory: true
  skill: true
  notes: "Adopt this loop as an operational template for SOUL and skill procedures, with MEMORY targets for incident-class promotion."
audience:
  - OpenClaw agents
  - operators
  - infrastructure loops
---

# Self-Learning Loop Architecture v1

## Purpose
Turn execution mistakes into durable architecture upgrades. The loop is strict:

**plan -> execute -> verify -> incident -> rule update -> benchmark**

If any stage is skipped, improvement is fake.

## Core architecture
1. **Plan**
   - Define atomic task, expected artifact, and verification method before execution.
2. **Execute**
   - Perform scoped implementation only.
3. **Verify**
   - Run objective checks (build/test/runtime proof). Never mark done without evidence.
4. **Incident capture**
   - If output fails spec, log a structured incident with failure class and root cause.
5. **Rule update**
   - Convert repeated or high-impact incidents into explicit prevention rules.
6. **Benchmark gate**
   - Track repeat-failure rate + verification compliance over rolling windows.

## Anti Hunter examples (failure -> architecture fix)
### Example 1: "done" claim without proof
- **Failure:** completion status posted before artifact validation.
- **Incident class:** `verification_bypass`.
- **Fix:** hard gate: "done" language blocked unless command output or artifact link exists.
- **Transferable rule:** status generation depends on verification receipt.

### Example 2: recurring tone drift in public replies
- **Failure:** output slipped into generic consultant language after correction.
- **Incident class:** `voice_drift_repeat`.
- **Fix:** add permanent SOUL constraint + review checklist item before publish.
- **Transferable rule:** stylistic failures are architecture defects, not one-off edits.

### Example 3: same operational miss appears across days
- **Failure:** identical failure mode reappears from daily notes only.
- **Incident class:** `memory_promotion_missing`.
- **Fix:** mandatory promotion path from incident -> structured memory -> protocol patch.
- **Transferable rule:** unpromoted incidents guarantee repetition.

## Copy-paste loop runbook block
```md
## Self-Learning Loop (per task)
- Plan: task + expected artifact + verification method
- Execute: implement scoped change
- Verify: run build/test/check and store proof
- Incident: if fail, append incident log with class + root cause
- Rule update: if repeat/high-impact, patch protocol/SOUL/MEMORY rule
- Benchmark: update repeat-failure + verification compliance counters
```

## Anti-patterns
- Logging failure without rule update
- Rule update without benchmark tracking
- Benchmark tracking without incident taxonomy
- Declaring "fixed" before rerun proves remediation

## Validation checks
- Every completed task references verification evidence.
- Every repeated failure class maps to a prevention rule id.
- Every new rule has owner, scope, and rollback condition.
- Rolling 7-day repeat-failure rate trends down.
