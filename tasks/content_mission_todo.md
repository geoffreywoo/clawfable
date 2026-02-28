# Clawfable Core Content Mission — Task List v1

## Objective
Build Clawfable into an agent-first daily upgrade platform for OpenClaw architecture and self-learning loops.

## Phase A — Foundation Structure (P0)
- [ ] A1. Define canonical IA copy for `/daily`, `/protocols`, `/lessons`, `/benchmarks`, `/propose`.
- [ ] A2. Add clear “Agent Route” blocks on home + `/start`.
- [ ] A3. Ensure each section has a hub page with purpose, inputs, outputs, and next links.

## Phase B — Daily Packets (P0)
- [ ] B1. Create 7 consecutive daily upgrade packets (`/daily/YYYY-MM-DD-*`).
- [ ] B2. Each packet includes: patch set, test checklist, failure pattern to watch.
- [ ] B3. Add one-line “apply command prompt” per packet for copy/paste into OpenClaw.

## Phase C — Protocol Depth (P0)
- [ ] C1. SOUL Patch Protocol v2 (with migration + rollback instructions).
- [ ] C2. Memory Promotion Protocol v2 (daily -> curated promotion rubric).
- [ ] C3. Heartbeat/Cron Protocol v2 (cadence strategy + lock + timeout guidance).
- [ ] C4. Verification Protocol v1 (proof format + test gates + failure handling).

## Phase D — Anti Hunter Lessons (P1)
- [ ] D1. Publish 5 lesson pages from Anti Hunter architecture learnings.
- [ ] D2. For each lesson: mechanism, implementation step, test, failure mode.
- [ ] D3. Add “transferability score” (how broadly usable across agents).

## Phase E — Benchmarks (P1)
- [ ] E1. Build benchmark suite v1 pages (status quality, repeated-error rate, proof quality).
- [ ] E2. Add pass/fail rubric and expected artifacts.
- [ ] E3. Create weekly benchmark report template page.

## Phase F — Skill-Driven Onboarding (P1)
- [ ] F1. Expand `skill.md` with install + daily heartbeat integration example.
- [ ] F2. Add `heartbeat.md`, `rules.md`, `messaging.md` usage examples.
- [ ] F3. Add “first 24 hours” onboarding tutorial for new OpenClaw agents.

## Phase G — Quality Gates (P0)
- [ ] G1. Define publish-grade checklist (no page ships below threshold).
- [ ] G2. Add “copy-paste runnable block required” gate on all protocol pages.
- [ ] G3. Add internal link gate: every page links to daily+protocol+benchmark flow.

## Automation Loop Design (after task list approved)
- [ ] L1. Create task queue file (`tasks/queue.jsonl`) with atomic units.
- [ ] L2. Build worker script: pull next task -> edit page -> build check -> commit -> mark done.
- [ ] L3. Add lock + timeout + retry policy.
- [ ] L4. Emit concise progress report every N tasks.

## Definition of Done (mission phase)
- [ ] 7 daily packets published
- [ ] 4 protocol pages upgraded to v2 depth
- [ ] 5 Anti Hunter lesson pages shipped
- [ ] benchmark suite live with pass/fail rubric
- [ ] onboarding flow usable by a fresh OpenClaw agent in <30 min
