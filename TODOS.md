# TODOS

## Activation Funnel

No open P1 items.

## Product

### Add analytics UI only after event volume is meaningful

**What:** Build the funnel visualization and retention views after event logging has enough real usage to justify interpretation.

**Why:** Logging is useful immediately, but a dashboard with tiny sample size creates false confidence and scope creep.

**Context:** Funnel instrumentation is now complete (all 5 milestones wired + `computeFunnelSummary` + metrics API). The UI should wait until the data is decision-grade.

**Effort:** M
**Priority:** P3
**Depends on:** Real user traffic generating event volume

## Platform

### Revisit broad multi-agent packaging after the one-account wedge is proven

**What:** Delay new multi-agent power-user UX, pricing expansion, and broader control-plane work until the single-account activation funnel proves conversion and retention.

**Why:** The current risk is not missing enterprise surface area. It is failing to prove one account can trust autopilot enough to launch and keep posting.

**Context:** CEO review narrowed the wedge to one paid outcome. Future multi-agent workflow work should be grounded in that proof instead of assumed upfront.

**Effort:** L
**Priority:** P3
**Depends on:** Activation funnel metrics and retention evidence

## Learning and Growth (data-gated)

### Verify the new learning signals populate in production

**What:** Confirm exploration holdouts, per-tweet profileClicks, follower snapshots, reach-weighted mentions, and dynamic idea seeds are appearing in KV with sane values after real cron cycles.

**Why:** All five mechanisms shipped 2026-08-30 with tests but no production observation; a silent tier restriction (non_public_metrics) or empty research corpus would degrade them invisibly (all degrade to null/absent by design).

**Effort:** S
**Priority:** P2
**Depends on:** ~24h of autopilot/research cron cycles; network access to production KV or the metrics API

### Attribute follower-growth windows to posts

**What:** Once follower snapshots span 1-2 weeks, join per-window follower deltas against posts live in each window (weighted by relative spread) and feed a bounded account-growth term into delayed rewards.

**Why:** Follower growth is the objective; today it reaches generation only as a prompt-level trend line. Per-tweet follows are not served by the API, so window attribution is the honest next step.

**Effort:** M
**Priority:** P2
**Depends on:** Follower snapshot history (6h cadence, started 2026-08-30)

## Audit follow-ups (2026-09-02)

The full-repo audit (16 dimensions, 3-lens verification) shipped its confirmed fixes on main. These are the items it deferred; work them one per loop tick.

### Verify the new signals populate in production

**What:** With the Vercel connector or KV read credentials, confirm `settling_6h` checkpoints, holdout flags, `profileClicks`, follower snapshots (null when X omits metrics), dynamic seeds, and `x_auth_*` connection notes are landing, and that the cron log shows per-agent error isolation rather than aborted ticks.

**Priority:** P1 · **Effort:** S · **Depends on:** production access from the loop container

### Primary model keeps the whole stage deadline

**What:** `generateText` gives the first target the entire stage deadline (pinned by test since commit `1b8618f`), so a hung primary never fails over within the deadline. If timeouts show up in fallback attempts in production, revisit with a bounded primary share.

**Priority:** P3 · **Effort:** S · **Depends on:** evidence from cron logs

### Watch the learned selection prior once posts accumulate

**What:** Draft selection now includes a bounded prior from the account's own outcome-backed arms (`scoreLearnedArmPrior`). It is inert until arms carry at least three performance-backed pulls, so it does nothing on a cold account by design. Once @geoffwoo has a few weeks of measured posts, check that the persisted `learnedArmPrior` on queued drafts is non-zero, that it correlates with what the learning tab reports as working, and that the 0.05 weight is still the right size (it should break ties, never overturn a quality gap).

**Priority:** P2 · **Effort:** S · **Depends on:** measured post volume

### Remaining low-severity audit items

- Explicit `modelChain` is appended after the task chain (documented and tested as fallback-only).
- Devin PR #113 (`devin/1788140342-lift-confidence`) inverts the holdout shield for low-reach flops; do not merge as-is.

## Completed

- **Audit follow-ups (2026-09-02)** — measured outcomes now order gate-passing drafts (`scoreLearnedArmPrior` + `V2_LEARNED_PRIOR_SELECTION_WEIGHT`); a queue version counter cancels an autopost when the operator mutates the queue mid-tick; the pending SOUL.md proposal has an approve/dismiss route and panel; malformed bodies return 400 across fifteen mutation routes; the dead `tier` option is gone.
- **Full-repo audit remediation (2026-09-02)** — eight fix clusters on main: auth token capture and secret exposure, storage lost-write race and silent KV fallback, bandit reward saturation and double observation, Geoffrey-only judging and floors for every account, preflight cringe veto, checkpoint ladder, quote/bookmark baselines, Anthropic schema transform, ranking inversion on first autopost, operator-draft quarantine, cadence cap drift, seed eligibility, soul-parser topic pollution, approval-mode soul evolution, route hardening, and iPhone rendering.
- **Launch orchestration** — Already server-side in `lib/setup-launch.ts` (single atomic endpoint)
- **Survivability guardrails** — `lib/survivability.ts`: posting jitter ±15%, original-post daily hard cap (12), proactive engagement excluded from original-post cap, content diversity gate, near-duplicate detection (bigram), postsPerDay clamped to 12 max. Wired into autopilot + protocol settings + launch.
- **Funnel instrumentation** — All 5 milestones wired (`wizard_start`, `wizard_soul_complete`, `preview_approve`, `first_post`, `tenth_post`). `getFunnelEvents` + `computeFunnelSummary` reader. Funnel summary exposed on metrics API.
- All earlier ad hoc TODOs were resolved before this review cycle.
