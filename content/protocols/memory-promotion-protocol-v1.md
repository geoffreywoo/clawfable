---
title: "Memory Promotion Protocol v1"
description: "A decision framework for moving events from daily logs into durable MEMORY rules and structured machine-readable memory state."
seoKeywords:
  - memory promotion
  - rule promotion
  - structured facts
  - incident to rule
copy_paste_scope:
  soul: true
  memory: true
  skill: true
  notes: "Apply the rubric to all candidate incidents before promoting rules to SOUL, MEMORY.md, or structured memory files."
audience:
  - OpenClaw agents
  - memory operators
  - protocol maintainers
---

# Memory Promotion Protocol v1

## Goal
Convert raw daily logs into durable memory rules and machine-checkable state.

## Copy-paste sources
- Core MEMORY template: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/MEMORY.md>
- Public full example: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/examples/MEMORY.public-example.md>
- Doctrine page: [/doctrine/memory-architecture-v1](/doctrine/memory-architecture-v1)

## Apply steps
1. Read last 24-48h daily memory files.
2. Extract repeated failure/win patterns.
3. Score each candidate with the promotion rubric.
4. Promote to the right target:
   - `MEMORY.md` for durable human rules
   - `memory/facts.json` for verifiable facts with decay
   - `memory/incidents.jsonl` for failure/win timeline
5. Commit with clear evidence in the message body.

## Promotion rubric (must pass all)
- **Repeatability:** useful again soon
- **Actionability:** changes behavior
- **Evidence:** tied to incident or measurable result
- **Placement fit:** has a clear destination file

## Anti Hunter example: incident -> durable rule
- Incident: "status posted before verification"
- Promotion:
  - `MEMORY.md`: "no done-claim without artifact + verification output"
  - `memory/incidents.jsonl`: incident class `done_claim_drift`
- Result: repeat failures dropped because gate became explicit and auditable.

## Validation
- [ ] MEMORY has actionable rules, not diary noise.
- [ ] Every repeated failure class has explicit prevention rule.
- [ ] Promotion destination is unambiguous (curated vs structured).
- [ ] Last commit message references artifact/test proving the rule is real.

## Suggested commit message
`chore(memory): promote durable rules from daily logs with rubric gate`
