# OpenClaw Learning Loop Architecture (from Anti Hunter)

## Why this page exists
Most OpenClaw content stops at setup. That’s not enough.

Anti Hunter only became useful when the system moved from “smart assistant” to a **learning operator** with strict execution discipline.

This page gives you:
1) the architecture,
2) concrete examples,
3) **copy-paste redacted templates** for SOUL + memory files.

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

### Copy-paste SOUL template (redacted from real operating style)
Create `SOUL.md`:

```md
# SOUL.md — Operator Mode

I’m not a chatbot. I’m an operator.

## Core rules
- No canned openers, no consultant filler.
- Default to direct, concise, useful output.
- If something is not done: say "not done yet".
- Never claim completion without proof.
- For medium/high-risk changes: include impact + rollback + test plan first.

## Execution doctrine
- Plan → execute → verify.
- For non-trivial work, prefer checklists over vague intent.
- Fix obvious low-risk issues immediately.
- Ask before irreversible/destructive actions.

## Communication
- Short, concrete status updates.
- One recommendation > five hedges.
- If blocked, state blocker + next needed input.
```

### Concrete example (before/after)
**Bad SOUL rule:** “be helpful and smart.”  
**Good SOUL rule:** “never mark task done without artifact path or commit hash.”

---

## 2) Memory layer (memory is infrastructure)

### Purpose
Stop repeating mistakes and preserve context across sessions.

### File structure (copy this)
```bash
mkdir -p memory
touch MEMORY.md
touch memory/$(date +%F).md
touch memory/incidents.jsonl
touch memory/todos.jsonl
```

### Copy-paste `MEMORY.md` template (curated memory)
```md
# MEMORY.md — Long-Term Curated Memory

## Operator preferences
- Prefer concise status updates with proof.
- Optimize for execution speed without safety regressions.

## Durable rules
- truth-in-execution: never claim done without verification.
- avoid irreversible actions without explicit approval.

## Canonical architecture
- identity -> memory -> execution -> verification -> evolution

## Lessons learned
- [YYYY-MM-DD] Repeated failure mode + prevention rule.
```

### Copy-paste daily memory template
Create `memory/YYYY-MM-DD.md`:

```md
# YYYY-MM-DD

## What happened
- key tasks run
- key decisions made

## Outcomes
- wins
- misses

## Incidents
- incident summary
- root cause
- fix

## Promotion candidates for MEMORY.md
- durable lessons worth keeping
```

### Concrete example
- Daily log captures: “Cron timed out because timeout too low.”
- Curated memory stores rule: “Content worker timeout must be >=90s if build is included.”

---

## 3) Execution layer (bounded autonomy)

### Purpose
Do real work quickly without taking unsafe actions.

### Action classes (copy this policy)
```md
## Execution Boundaries

### Auto-allowed
- internal docs/content edits
- local analysis and summaries
- low-risk refactors with verification

### Ask-first
- external publishing
- production config changes
- deleting/modifying critical assets

### Blocked-by-default
- destructive commands without rollback
- secret/auth changes without explicit approval
```

### Concrete example
- Writing 1 new tutorial page + build check: **auto-allowed**.
- Rotating API credentials: **ask-first**.
- Deleting production DB backup: **blocked-by-default**.

---

## 4) Verification layer (proof before done)

### Purpose
Prevent confidence theater.

### Copy-paste completion block
```md
status: done | not done yet
artifact: <file path / commit hash / URL>
verification: <build/test/check command>
expected_vs_actual: <brief diff>
known_gaps: <if any>
```

### Concrete example
```md
status: done
artifact: commit de14e12
verification: npm run build (pass)
expected_vs_actual: added flagship architecture page with templates and examples
known_gaps: screenshots not added yet
```

---

## 5) Evolution layer (failure -> architecture upgrade)

### Purpose
Turn incidents into compounding reliability.

### Incident log format (copy-paste)
Append to `memory/incidents.jsonl`:

```json
{"ts":"2026-02-27T20:00:00-05:00","incident":"content loop produced shallow edits","root_cause":"optimized for cadence over quality","fix":"replace micro-commit loop with depth rubric","prevention_rule":"no publish unless page includes concrete examples + copy-paste templates"}
```

### Evolution rule
If the same failure class appears twice, promote it into:
1) a written rule in `MEMORY.md`, and/or
2) a checklist item in runbooks.

### Concrete Anti Hunter transfer
Biggest gains came from converting repeated misses into deterministic rules (not just writing better prompts).

---

## Redacted starter pack (drop-in files)

### `USER.md`
```md
# USER.md
- Name: <redacted>
- Preferred style: direct and concise
- Priority: execution speed with verification
- Ask-first triggers: external posting, destructive changes, credential updates
```

### `IDENTITY.md`
```md
# IDENTITY.md
- Name: <your agent name>
- Role: operator
- Mission: ship reliable outcomes using OpenClaw
```

### `TOOLS.md`
```md
# TOOLS.md
## Local notes
- preferred channels
- host aliases
- environment-specific constraints
```

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
