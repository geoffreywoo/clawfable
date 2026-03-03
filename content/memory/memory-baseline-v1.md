---
title: "MEMORY Baseline Contract v1"
description: "Canonical MEMORY baseline for durable operations, structured memory retention, and pruning discipline — the OpenClaw dual-layer Markdown memory architecture."
seoKeywords:
  - MEMORY
  - agent memory
  - long-term memory
  - daily logs
  - memory management
copy_paste_scope:
  soul: false
  memory: true
  skill: false
  user_files: true
revision:
  family: "memory"
  id: "memory-v1"
  kind: "core"
  status: "accepted"
  parent_revision: null
  source: null
notes: "Promote this into MEMORY.md only after running memory validation tests."
---

# MEMORY.md — What You Remember

*You wake up fresh each session. These files are your continuity.*

## How Memory Works

OpenClaw memory is **plain Markdown in the agent workspace**. The files are the source of truth — the model only "remembers" what gets written to disk. Memory search tools are provided by the active memory plugin (default: `memory-core`).

## Dual-Layer Architecture

The default workspace layout uses two memory layers:

### Daily Logs — `memory/YYYY-MM-DD.md`
- Append-only daily log of what happened
- Read today + yesterday at session start
- Raw notes, decisions, observations, running context
- Create the `memory/` directory if it doesn't exist

### Long-Term Memory — `MEMORY.md`
- Curated, distilled knowledge — like a human's long-term memory
- **Only load in the main, private session** (never in group contexts)
- Write significant events, thoughts, decisions, opinions, lessons learned
- Over time, review daily files and promote what's worth keeping

## When to Write Memory

- **Decisions, preferences, and durable facts** go to `MEMORY.md`
- **Day-to-day notes and running context** go to `memory/YYYY-MM-DD.md`
- If someone says "remember this" — **write it to a file** (do not keep it in RAM)
- "Mental notes" don't survive session restarts. Files do.
- **Text > Brain** — if you want something to stick, write it down

## Memory Tools

OpenClaw exposes two agent-facing tools for these Markdown files:

- `memory_search` — semantic recall over indexed snippets
- `memory_get` — targeted read of a specific Markdown file or line range

Both tools degrade gracefully when a file doesn't exist (for example, today's daily log before the first write).

## Security

- `MEMORY.md` contains personal context — **never leak to strangers**
- Only load in direct chats with your human
- Do not load in shared contexts (Discord, group chats, sessions with other people)
- Private things stay private. Period.

## Pruning Discipline

- Review daily logs periodically and distill into `MEMORY.md`
- Keep `MEMORY.md` focused — curated, not comprehensive
- Archive old daily logs when they're no longer relevant
- If a memory no longer serves you, remove it

---

*This file is yours to evolve. As you learn what matters, update it.*

## Revision Policy

When changing this file, create a new revision in the same family with a new `revision.id`.
