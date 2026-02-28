# OpenClaw Learning Loop Architecture (from Anti Hunter)

## Why this page exists
Most OpenClaw content stops at setup. That’s not enough.

Anti Hunter only became useful when the system moved from “smart assistant” to a **learning operator** with strict execution discipline.

This page is the practical architecture for that transition.

## Target outcome
By the end, you should have an OpenClaw system that:
- executes real tasks with clear boundaries,
- captures lessons in memory,
- converts failures into updated rules,
- gets more reliable over time.

---

## The 5-layer learning loop

1. **SOUL layer** → defines execution identity and quality bar
2. **Memory layer** → records outcomes and decisions
3. **Execution layer** → performs work with tool boundaries
4. **Verification layer** → blocks fake “done” claims
5. **Evolution layer** → upgrades architecture based on incidents

If any layer is missing, compounding breaks.

---

## 1) SOUL layer (identity before autonomy)

### Purpose
Set stable operating behavior so the agent doesn’t drift into generic, low-signal output.

### Minimum fields to define
- communication style (direct/concise/no template slop)
- decision policy (default action + when to escalate)
- truth policy (never claim done without proof)
- risk policy (what requires approval)

### Example SOUL constraints
```md
- no canned phrasing
- no "done" without artifact/runtime verification
- for medium/high-risk actions: impact + rollback + test plan first
- optimize for useful output, not message volume
```

### Common failure mode
**Failure:** SOUL is vague (“be helpful”).  
**Fix:** convert vague values into explicit operational rules.

---

## 2) Memory layer (memory is infrastructure)

### Purpose
Stop repeating mistakes and preserve context across sessions.

### Recommended memory split
- `memory/YYYY-MM-DD.md` → raw daily events
- `MEMORY.md` → durable long-term rules/decisions
- optional structured files:
  - `memory/facts.json`
  - `memory/incidents.jsonl`
  - `memory/todos.jsonl`

### Operational pattern
- every significant failure gets an incident line
- every durable lesson becomes a rule in curated memory
- every repeated blocker becomes a runbook step

### Common failure mode
**Failure:** memory is treated as a journal only.  
**Fix:** promote repeated learnings into explicit constraints/checklists.

---

## 3) Execution layer (bounded autonomy)

### Purpose
Do real work quickly without taking unsafe actions.

### Required boundary model
Split actions into 3 classes:

1. **Auto-allowed** (safe, reversible)
   - drafting content
   - internal docs updates
   - local analysis

2. **Ask-first** (external or medium-risk)
   - publishing public messages
   - changing production settings
   - deleting/modifying critical assets

3. **Blocked by default**
   - destructive operations without rollback
   - secret/auth changes without approval

### Common failure mode
**Failure:** everything is either blocked or fully open.  
**Fix:** use this 3-class model so speed and safety coexist.

---

## 4) Verification layer (proof before done)

### Purpose
Prevent confidence theater.

### Required completion gate
Before marking complete:
- run check/test/build (if relevant)
- compare expected vs actual output
- provide artifact proof (file path, commit hash, URL, log)

### Completion format (simple)
```md
status: done / not done yet
artifact: <path|commit|url>
verification: <what was run>
known gaps: <if any>
```

### Common failure mode
**Failure:** reports say “done” but nothing changed.  
**Fix:** enforce artifact + verification fields every time.

---

## 5) Evolution layer (failure -> architecture upgrade)

### Purpose
Turn incidents into compounding reliability.

### Evolution loop
1. incident occurs
2. root cause identified
3. patch current issue
4. add prevention rule/runbook step
5. verify in next similar scenario

### Anti Hunter transfer pattern
The biggest gain wasn’t better prompts. It was turning recurring failure modes into durable constraints and playbooks.

### Common failure mode
**Failure:** same bug class reappears weekly.  
**Fix:** if repeated twice, promote to architecture-level rule.

---

## Implementation checklist (copy this)

- [ ] SOUL has explicit execution + risk + truth rules
- [ ] memory split is active (daily + curated)
- [ ] action boundaries defined (auto / ask-first / blocked)
- [ ] completion requires proof + verification
- [ ] incidents are logged and converted into prevention rules

---

## When this architecture is the wrong fit
Use a simpler stack if you only need deterministic ETL/task automation.

This architecture is for judgment-heavy operations with real context and evolving policy constraints.

---

## What to implement next
1. [OpenClaw Configuration Deep Dive](/guides/openclaw-configuration-deep-dive)
2. [OpenClaw Troubleshooting Handbook](/guides/openclaw-troubleshooting-handbook)
3. [Anti Hunter as an OpenClaw Architecture Case Study](/case-studies/antihunter-openclaw-architecture)
