# TODOS

## Activation Funnel

No open P1 items.

## Product

### Add analytics UI only after event volume is meaningful

**What:** Build the funnel visualization and retention views after event logging has enough real usage to justify interpretation.

**Why:** Logging is useful immediately, but a dashboard with tiny sample size creates false confidence and scope creep.

**Context:** The review kept event logging in the plan but deferred analytics UI. The current repo can store funnel events, but the UI should wait until the data is decision-grade.

**Effort:** M
**Priority:** P3
**Depends on:** Reliable funnel instrumentation for `wizard_start`, `wizard_soul_complete`, `preview_approve`, `first_post`, and `tenth_post`

## Platform

### Revisit broad multi-agent packaging after the one-account wedge is proven

**What:** Delay new multi-agent power-user UX, pricing expansion, and broader control-plane work until the single-account activation funnel proves conversion and retention.

**Why:** The current risk is not missing enterprise surface area. It is failing to prove one account can trust autopilot enough to launch and keep posting.

**Context:** CEO review narrowed the wedge to one paid outcome. Future multi-agent workflow work should be grounded in that proof instead of assumed upfront.

**Effort:** L
**Priority:** P3
**Depends on:** Activation funnel metrics and retention evidence

## Completed

- **Launch orchestration** — Already server-side in `lib/setup-launch.ts` (single atomic endpoint)
- **Survivability guardrails** — `lib/survivability.ts`: posting jitter ±15%, daily hard cap (12), content diversity gate, near-duplicate detection (bigram), postsPerDay clamped to 10 max. Wired into autopilot + protocol settings + launch.
- All earlier ad hoc TODOs were resolved before this review cycle.
