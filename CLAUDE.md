# CLAUDE.md

This file gives Claude Code the operating context for Clawfable. Treat it as the project-specific source of truth, then verify details against the code before changing behavior.

## Project Snapshot

Clawfable is an AI autopilot for X accounts. The product helps a creator, founder, operator, or small team train a voice profile, review generated posts, launch a supervised/autonomous posting loop, and learn from approvals, edits, deletes, replies, impressions, and follower growth.

The current wedge is one account getting to a trusted autopilot launch. Multi-agent and broader control-plane work exists in the codebase, but product decisions should prioritize proving the single-account activation and retention loop.

Core user flow:

1. Authenticate with X.
2. Create an agent and connect the X account.
3. Define or generate a SOUL.md voice profile.
4. Review the first batch of generated posts.
5. Launch autopilot when the output feels right.
6. Learn from outcomes and adjust voice, ranking, cadence, and engagement strategy.

## Operating Principles

- Start by checking worktree state and reading the relevant guidance. Preserve unrelated user changes, especially in dirty main checkouts or detached automation worktrees.
- Prefer one concrete, high-leverage improvement per run over broad refactors. The best changes usually improve creative quality, learning speed, ranking correctness, survivability, or end-user trust.
- Keep learning and ranking changes auditable. Preserve raw and adjusted scores, provenance fields, blockers, preference hints, memory signals, and structured metadata instead of hiding behavior inside final text.
- Do not overclaim root cause from one plausible path. For production incidents, inspect queue state, KV truth, cron/post logs, provider health, and live surfaces before declaring the diagnosis complete.
- If the request includes shipping, pushing live, production recovery, automation, or "check again", carry it through commit/push/deploy/live verification unless explicitly told to stop.
- Avoid unofficial X scraping or browser automation against X. Use official APIs, stored app data, KV inspection, and safe public-site verification.
- For production Vercel checks, inspect the specific deployment until it is `Ready`, confirm aliases, then smoke-check the live domain. Do not trust only the newest `vercel ls` row.
- When reporting completion, say what changed, why it improves end-user utility or creative learning, what passed, what could not be verified, and the next bottleneck if one is obvious.

## Product Taste

Clawfable should feel like a trustworthy publishing teammate, not a bot farm, command center, or AI infrastructure demo. The product earns trust when it helps one real account sound more like itself, make better editorial decisions, and learn from outcomes.

Default product judgment:

- Optimize for the single-account activation and retention loop before multi-agent packaging.
- Value fewer, better drafts over more generated content. Queue quality matters more than queue volume.
- Favor supervised trust-building flows: review the first batch, explain why drafts are strong or risky, and make autopilot feel reversible.
- Treat operator edits, approvals, deletes, live deletions, replies, and performance as high-signal product data.
- Prefer mechanisms that make quality visible: score provenance, judge notes, queue health, slop risk, authority proof, duplicate gates, and learning summaries.
- Do not turn the UI into an analytics cockpit before there is meaningful event volume. Useful feedback loops beat decorative dashboards.

## Account Voice And Generation Quality

No Clawfable account should read like generic AI advice with the handle swapped in. Generation and ranking should actively avoid recognizable generated-post cadence for every account, while preserving each account's own SOUL.md, topics, risk boundaries, and human examples. @geoffreywoo is one visible example of this bar, not a special-case exception.

For generated posts:

- Prefer lived-in, account-specific observations over polished abstraction.
- Use concrete evidence appropriate to the account: screenshots, workflow before/after, support queues, exception logs, customer language, metrics, failure modes, source material, field notes, and ownership details.
- Avoid default AI cadence: "not X, but Y", "the real edge/moat/question", "most people don't realize", "the winners will be", and clean consultant scaffolds that could fit any AI account.
- Be careful with abstract words like leverage, moat, signal, optics, systems, velocity, feedback loop, playbook, narrative, and compounding. They need concrete proof or a fresh angle.
- Human rhythm can be asymmetric. Fragments are fine when the voice supports them. Perfectly balanced advice often reads generated.
- Anti-slop work should usually touch `lib/viral-generator.ts`, `lib/generation-judging.ts`, `lib/virality-signals.ts`, `lib/candidate-ranking.ts`, and focused tests.
- If regenerating production queue content, delete or demote the stale queued drafts, record the negative learning signal, then refill through the app/autopilot path that uses current ranking rules. Verify queue depth and slop scores afterward.

## Commands

```bash
npm run dev          # Start local dev server at http://localhost:3000
npm run typecheck    # TypeScript type checking (tsc --noEmit --pretty false)
npm test             # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
npm run build        # Next.js production build
npm run audit        # Typecheck + production build
npm start            # Start production server
```

No linter is configured. TypeScript strict mode is off. Use `npm run typecheck` and focused Vitest runs as the default verification path; use `npm run audit` before broad or release-oriented changes.

## Tech Stack

- Next.js 16 App Router with React 19 and TypeScript.
- Plain CSS in `app/globals.css`; no Tailwind and no component library.
- Vercel KV via `@vercel/kv`, with automatic in-memory fallback for local development.
- X/Twitter integration through `twitter-api-v2` and OAuth 1.0a.
- AI providers through `openai` and `@anthropic-ai/sdk`.
- Stripe billing through `stripe`.
- Markdown parsing through `gray-matter` and `marked`.
- Vitest with React plugin for tests.

## Architecture

Keep business logic in `lib/`. Route handlers and React components should be thin adapters around library functions when possible.

Primary layers:

- `app/` - Next.js App Router pages, layouts, API routes, and client/server components.
- `app/api/` - REST-style route handlers. Agent-scoped routes live under `app/api/agents/[id]/`.
- `app/components/` - Client and shared UI components for marketing, setup, dashboard, control room, review, queue, learning, metrics, settings, and engagement.
- `lib/` - Business logic, persistence helpers, AI routing, Twitter/X wrappers, billing, learning, ranking, survivability, and domain types.
- `test/` - Vitest coverage for library behavior and API routes.
- `public/souls/` - Public SOUL.md examples.
- `companion/` - Browser companion service and package metadata.

Important app surfaces:

- `app/page.tsx` - Public marketing page.
- `app/pricing/page.tsx` - Pricing page.
- `app/souls/page.tsx` and `app/souls/[handle]/page.tsx` - Public open-source soul library.
- `app/control-room/page.tsx` - Authenticated control room.
- `app/agent/[id]/page.tsx` - Agent dashboard entry.

Important components:

- `setup-wizard.tsx` and `setup-continuation.tsx` - Onboarding and launch preparation.
- `agent-dashboard-client.tsx` / `agent-dashboard-shell.tsx` - Agent workspace shell.
- `compose-tab.tsx`, `review-tab.tsx`, `queue-tab.tsx` - Draft review and publishing workflow.
- `autopilot-tab.tsx`, `learning-tab.tsx`, `insights-tab.tsx`, `metrics-tab.tsx` - Autopilot state, learning, and performance.
- `unified-engage-tab.tsx`, `engage-tab.tsx`, `mentions-tab.tsx` - Supervised replies and engagement.
- `settings-tab.tsx` - Agent config, X connection, SOUL.md editing.

## Core Domain

The main domain types live in `lib/types.ts`.

- `User` represents the authenticated X user and billing relationship.
- `Session` is stored through signed session cookie helpers.
- `Agent` owns handle, display name, SOUL.md, connection credentials, setup step, and public/private soul state.
- `Tweet` and `TweetJob` represent generated drafts, queue entries, posted items, and lifecycle state.
- `Mention`, `EngagementSession`, and relationship/opportunity types support supervised engagement.
- Learning-related types include voice directives, feedback, reward breakdowns, bandit outcomes, manual examples, and health snapshots.
- Billing types include plan, status, entitlements, and Stripe IDs.

Tweet statuses include `preview`, `draft`, `queued`, `posted`, and `deleted_from_x`. Preserve lifecycle semantics when editing queue or posting code.

## Persistence

`lib/kv-storage.ts` is the persistence abstraction. Use it instead of talking directly to KV from routes or components.

Storage behavior:

- Production uses Vercel KV when KV environment variables are configured.
- Local development falls back to an in-memory `globalThis` store, so `npm run dev` works with zero KV setup.
- The module has a request-scoped read cache; writes and deletes must invalidate relevant keys/namespaces.
- Agent deletion is expected to cascade related agent data.
- Counters generate sequential IDs for entities such as agents, tweets, and mentions.

Key patterns are hierarchical: `agent:${id}`, `agent:${id}:tweets`, `agent:${id}:queue`, and related namespace keys. Preserve this pattern for new storage.

## AI Routing

`lib/ai.ts` centralizes model/provider access. Do not instantiate OpenAI or Anthropic clients ad hoc in feature code.

Current behavior:

- AI tasks are explicit (`tweet_generation`, `creative_variant`, `bulk_judgment`, `final_judgment`, `reply_generation`, `reply_scoring`, `learning`, `classification`, `soul_generation`, `exceptional`, and defaults).
- Model chains are resolved per task, with de-duplication and provider fallback semantics.
- OpenAI uses the Responses API.
- Anthropic uses Messages API.
- Tests can run without real Anthropic credentials.
- OpenAI reasoning effort can be configured globally or per task through environment variables.

Environment variables relevant to AI:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_REASONING_EFFORT`
- `OPENAI_REASONING_EFFORT_<TASK_NAME>`

When changing models, routing, reasoning effort, or fallback behavior, update and run `test/ai-routing.test.ts`.

## Important Library Modules

- `auth.ts`, `session-cookie.ts`, `account-access.ts`, `internal-accounts.ts` - Auth, user/session access, and account ownership.
- `billing.ts`, `billing-sync.ts`, `stripe.ts` - Stripe plans, entitlement checks, checkout, portal, and webhook sync.
- `twitter-client.ts`, `twitter-debug.ts`, `twitter-read-backoff.ts`, `x-account-conflicts.ts` - X API access, OAuth credentials, diagnostics, and read backoff.
- `soul-parser.ts`, `soul-from-tweets.ts`, `voice-directives.ts`, `style-mode.ts` - SOUL.md parsing, generated voice profiles, and voice rules.
- `analysis.ts`, `tweet-features.ts`, `generation-context.ts`, `source-planner.ts`, `trending.ts` - Account/content analysis and source planning.
- `viral-generator.ts`, `candidate-ranking.ts`, `generation-judging.ts`, `virality-signals.ts`, `global-bandit-prior.ts`, `bandit.ts` - Candidate generation, scoring, ranking, and reward prediction.
- `survivability.ts`, `autopilot.ts`, `autopilot-status.ts`, `autopilot-health.ts`, `queue-healing.ts`, `setup-launch.ts` - Launch, posting loop, cadence, safety, queue repair, and health.
- `learning-loop.ts`, `learning-snapshot.ts`, `soul-evolution.ts`, `taste-calibration.ts`, `outcome-rewards.ts`, `performance.ts`, `metrics-snapshot.ts`, `voice-tuning-analytics.ts` - Feedback and learning pipeline.
- `engagement.ts`, `proactive-engagement.ts`, `growth-engine.ts`, `job-suggestions.ts` - Engagement and growth opportunity workflows.
- `browser-companion.ts` - Browser companion pairing and actions.
- `request-validation.ts`, `request-origin.ts`, `delete-intent.ts`, `oauth-start-error.ts` - Route validation and defensive request handling.

## API Route Map

Agent routes are under `app/api/agents/[id]/`:

- Setup and config: `wizard`, `launch`, `connect`, `disconnect`, `generate-soul`, `calibration`.
- Generation and review: `generate-tweet`, `generate-reply`, `remix`, `voice-chat`, `protocol/generate`, `protocol/run`, `protocol/settings`.
- Queue and posting: `queue`, `queue/[tweetId]`, `twitter/post`, `twitter/mentions`, `twitter/search`, `twitter/like`.
- Data and learning: `dashboard`, `analysis`, `analyze`, `metrics`, `metrics/timeseries`, `learning`, `learnings`, `learning-signal`, `learning/manual-examples`, `mentions`.
- Growth and engagement: `engage/sessions`, `engage/draft-reply`, `engage/resolve-target`, `growth/opportunities`, `growth/diagnostics`, `topics`.

Other route groups:

- `app/api/auth/*` - Login, logout, current user, and Twitter OAuth callback flow.
- `app/api/billing/*` and `app/api/stripe/webhook` - Checkout, portal, and billing sync.
- `app/api/cron/post` and `app/api/cron/log` - Scheduled autopilot and logging.
- `app/api/browser-companion/*` - Pairings and action reporting.
- `app/api/public/*` - Public soul and agent profile data.
- `app/api/control-room`, `app/api/dev/bootstrap`, `app/api/seed` - Control room data, local/dev bootstrap, and seed helpers.

## Design System

Always read `DESIGN.md` before making visual or UI decisions. The current design direction is a bright creator workspace, not a dark terminal aesthetic.

Key design facts:

- Product mood: friendly publishing teammate, helpful, optimistic, safe to try.
- Audience: creators, founders, operators, and small teams.
- Typography: Outfit for display, Manrope for body, IBM Plex Mono for sparse labels/data/code.
- Background: warm off-white `#f6f1e7`.
- Surface: `#fffdf8`, `#f3ebdf`, `#fbf6ee`, and elevated white.
- Primary: green `#4a8b67`, hover `#3d7556`.
- Accent washes: peach `#ffe4d4`, pale blue `#dcecff`, butter `#f8e7b2`.
- Marketing width: 1180-1240px. Control-room width: 1200px.
- Primary breakpoint: 900px.
- Minimum touch target: 44px.
- Focus: 2px solid green outline with offset.

UI copy should be warm, concrete, and confidence-building. Prefer phrases like "train your voice", "review the first batch", and "turn on autopilot when it feels right". Avoid terminal/infrastructure jargon such as "protocol" or "mission control" on public pages unless the context truly requires it.

Design execution guidance:

- Build the actual usable workflow first. Do not make a generic SaaS landing page when the task calls for a product surface.
- Use dense, calm operational layouts for dashboards and control-room surfaces. Avoid oversized hero treatment, decorative card piles, or marketing composition inside tools.
- Keep cards for repeated items, modals, and framed tools. Do not nest cards inside cards or make whole page sections look like floating cards.
- Use the existing plain CSS system in `app/globals.css`; do not introduce Tailwind or a component library.
- Use familiar controls: icon buttons for tools, toggles for binary settings, segmented controls for modes, tabs for views, sliders/inputs for numbers, and menus for option sets.
- Ensure text fits at mobile and desktop breakpoints. Stable dimensions matter for boards, queues, toolbars, counters, and compact dashboard panels.
- Avoid one-note palettes, dark terminal styling, gradient-orb decoration, and generic AI imagery.
- Public copy should sound warm and concrete. In-product copy can be operational, but should still sound like a teammate, not internal infrastructure.

## Product State And Roadmap

From `TODOS.md`, there are no open P1 activation-funnel items.

Completed platform/product work includes:

- Server-side launch orchestration in `lib/setup-launch.ts`.
- Survivability guardrails in `lib/survivability.ts`: jittered posting cadence, daily original-post cap, proactive engagement exclusion from original-post cap, content diversity gate, near-duplicate detection, max posts-per-day clamp, and policy-risk scoring.
- Funnel instrumentation for `wizard_start`, `wizard_soul_complete`, `preview_approve`, `first_post`, and `tenth_post`, with summary metrics exposed through the metrics API.

Open deferred work:

- Build analytics UI only after event volume is meaningful.
- Revisit broad multi-agent packaging only after the one-account wedge proves conversion and retention.

## Environment

Local dev works without KV credentials because storage falls back to memory.

Production KV variables:

```bash
KV_URL
KV_REST_API_URL
KV_REST_API_TOKEN
KV_REST_API_READ_ONLY_TOKEN
```

Other commonly relevant variables:

```bash
OPENAI_API_KEY
ANTHROPIC_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

X account connection is handled through OAuth 1.0a in the auth/setup flow. Agent OAuth credentials are stored per agent; avoid exposing them to client components.

## Testing Guidance

- Prefer focused tests near the changed behavior, then run broader suites when touching shared modules.
- API route tests are common and should cover request validation, ownership, and persistence side effects.
- Storage changes should cover both KV-like behavior and local in-memory fallback assumptions.
- AI routing changes should cover model chain resolution, provider configuration, reasoning effort, and fallback behavior.
- Queue/autopilot changes should cover survivability, ownership, status transitions, and duplicate prevention.
- Billing changes should cover plan entitlement boundaries and webhook synchronization.

Common verification patterns:

- Generation/ranking changes: focused Vitest for the touched seam, then `npm test`, `npm run typecheck`, and `npm run build`.
- AI routing changes: update and run `test/ai-routing.test.ts`, then typecheck.
- Queue/autopilot or production-recovery changes: inspect KV/queue truth before and after, preserve locks, avoid accidental posting, and verify live app/API surfaces.
- Frontend changes: run focused tests if present, start `npm run dev` when useful, and use `/browse` or browser QA against the local URL.
- Ship/live requests: push the intended commit, inspect Vercel until `Ready`, confirm `clawfable.com` and `www.clawfable.com` aliases, and run HTTP smoke checks.

## Repository Hygiene

- Do not commit secrets, `.env*.local`, `.next`, `node_modules`, or generated local state.
- `.agents/` is ignored and can contain large local/generated skill installs.
- `.claude/settings.local.json` is ignored local state.
- `.claude/skills/` is tracked in this repository; do not delete or regenerate it casually.
- Preserve unrelated user changes in the working tree.

## gstack

Use the `/browse` skill from gstack for web browsing and local app QA. Do not use `mcp__Claude_in_Chrome__*` tools.

Available gstack skills include:

- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/review`
- `/ship`
- `/land-and-deploy`
- `/canary`
- `/benchmark`
- `/browse`
- `/qa`
- `/qa-only`
- `/design-review`
- `/setup-browser-cookies`
- `/setup-deploy`
- `/retro`
- `/investigate`
- `/document-release`
- `/codex`
- `/cso`
- `/careful`
- `/freeze`
- `/guard`
- `/unfreeze`
- `/gstack-upgrade`

If gstack skills are broken, run:

```bash
cd .claude/skills/gstack && ./setup
```
