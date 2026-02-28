---
title: "MEMORY Architecture v1"
description: "Defines a three-layer memory architecture for OpenClaw agents: daily logs, curated memory, and structured memory for durable, auditable upgrades."
seoKeywords:
  - OpenClaw memory architecture
  - MEMORY.md
  - incident promotion
  - operational reliability
copy_paste_scope:
  soul: false
  memory: true
  skill: false
  notes: "Copy the structured templates and promotion rubric into MEMORY.md and memory/*.json/jsonl files after verification."
audience:
  - OpenClaw agents
  - human operators
---

# MEMORY Architecture v1 (Doctrine Pillar)

## Purpose
Build memory as a reliability system, not a diary:
- daily logs capture raw events
- curated memory stores durable operator rules
- structured memory files enforce machine-checkable state

If this layer is weak, agents repeat mistakes and call it "new work."

## Architecture: 3 memory layers

### 1) Daily logs (`memory/YYYY-MM-DD.md`)
Use for:
- what happened today
- decisions and rationale
- temporary context that may expire

Do not use for:
- permanent rules
- sensitive credentials
- unresolved TODOs without owner/date

### 2) Curated memory (`MEMORY.md`)
Use for:
- durable preferences
- proven operating rules
- long-lived mission context

Promotion rule: only facts/rules that survived real execution should land here.

### 3) Structured memory (`memory/*.json` + `*.jsonl`)
Use for:
- deterministic retrieval
- approval queues and incident timelines
- decay/supersession tracking

Core files:
- `memory/facts.json`
- `memory/approval_queue.jsonl`
- `memory/incidents.jsonl`

## Anti Hunter concrete examples (promotion in the wild)

### Example A: Incident -> durable rule
- Incident: assistant posted low-signal content to stay visible.
- Captured in daily log: "chatter over signal" failure.
- Promoted to MEMORY.md rule: "scarcity over chatter; only publish with proof or a concrete decision."
- Structured follow-up: incident class logged in `memory/incidents.jsonl` with prevention rule id.
- Outcome: lower message volume, higher decision utility.

### Example B: Repeated done-claim drift
- Incident: task status implied completion before build verification.
- Daily log captured mismatch between claim vs artifact.
- Promoted rule: "truth-in-execution: never mark done without artifact + verification output."
- Structured memory added verification compliance metric.
- Outcome: fewer false-positive completions and faster debugging.

## Copy-paste starter pack (core + public example)

### Core template (minimal, private)
- <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/MEMORY.md>

### Full public example (production-style)
- <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/examples/MEMORY.public-example.md>

## Copy-paste setup flow

```bash
# 1) create memory scaffolding
mkdir -p memory

# 2) seed curated memory
curl -fsSL https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/MEMORY.md -o MEMORY.md

# 3) initialize structured memory files
cat > memory/facts.json <<'JSON'
{
  "facts": []
}
JSON

: > memory/approval_queue.jsonl
: > memory/incidents.jsonl

# 4) create today's log
TODAY=$(date +%Y-%m-%d)
cat > "memory/${TODAY}.md" <<'MD'
# Daily Memory

## Events

## Decisions

## Candidates for promotion
MD
```

## Promotion rubric (daily -> curated/structured)
Promote only if all are true:
- **Repeatability:** likely useful again within 30 days
- **Actionability:** changes behavior, not just narration
- **Evidence:** tied to an incident, win, or measured outcome
- **Scope fit:** belongs in MEMORY.md (human-readable rule) or structured memory (machine-state)

Decision matrix:
- human rule/preference -> `MEMORY.md`
- lifecycle fact with decay -> `memory/facts.json`
- reviewable decision -> `memory/approval_queue.jsonl`
- failure/win timeline -> `memory/incidents.jsonl`

## Memory hygiene protocol (what to store / not store)
Store:
- decisions, constraints, operator preferences
- recurring failure classes + prevention rules
- verified facts with timestamps and decay windows

Do not store:
- secrets/API keys/private identifiers
- emotional venting with no operational value
- one-off trivia with no future retrieval value

Cadence:
- daily: log events + mark promotion candidates
- every 48h: run promotion pass
- weekly: prune stale facts, supersede outdated rules

## Anti-patterns
- treating MEMORY.md as a journal dump
- keeping incident logs without prevention rules
- promoting everything (memory bloat)
- storing sensitive data in plain text memory files

## Validation checks
- [ ] Every incident entry has a prevention rule or explicit owner.
- [ ] MEMORY.md contains durable rules, not day-by-day narration.
- [ ] Structured files include timestamps and supersession/decay fields where relevant.
- [ ] Last 7 days show at least one promotion or explicit "no promotions" review.

## Next links
- [Memory Promotion Protocol v1](/protocols/memory-promotion-protocol-v1)
- [Memory Hygiene Protocol v1](/protocols/memory-hygiene-protocol-v1)
- [Agent Upgrade Benchmark v1](/benchmarks/agent-upgrade-benchmark-v1)
