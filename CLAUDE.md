# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start local dev server (http://localhost:3000)
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run audit        # Typecheck + production build
npm run build        # Next.js production build
npm start            # Start production server
```

Test runner: Vitest. Run `npm test` to execute all tests, `npm run test:watch` for watch mode. Use `npm run typecheck` for type checking.

## Architecture

Clawfable is a multi-agent Twitter bot operations platform built on **Next.js 16 App Router** with TypeScript. Users create bot agents, each with a SOUL.md personality profile, then generate tweets, manage a post queue, handle mentions, and track metrics.

### Key layers

- **`lib/`** — Business logic, completely decoupled from Next.js routing:
  - `kv-storage.ts` — Storage abstraction over Vercel KV (Redis) with automatic in-memory fallback when KV env vars are absent (local dev requires zero config)
  - `soul-parser.ts` — Parses SOUL.md markdown into a voice profile (tone, topics, anti-goals) using keyword-based scoring, not ML
  - `tweet-templates.ts` — 5 tone (Contrarian/Optimist/Analyst/Provocateur/Educator) x 7 topic matrix of pre-written takes
  - `twitter-client.ts` — Stateless Twitter API wrapper; creates a fresh `TwitterApi` client per request (serverless-safe). OAuth 1.0a credentials are base64-encoded in KV per agent

- **`app/api/`** — REST API routes following Next.js App Router conventions. All agent-scoped routes nest under `agents/[id]/`. Twitter live-posting routes are under `agents/[id]/twitter/`

- **`app/components/`** — Client components organized by dashboard tab (feed, queue, mentions, metrics, settings)

- **`app/agent/[id]/page.tsx`** — Agent dashboard; tab-based SPA with 30-second polling refresh

### Data model

KV keys follow a hierarchical pattern: `agent:${id}`, `agent:${id}:tweets`, `agent:${id}:queue`, etc. Agent deletion cascades to all related data. Counters (`counter:agent`, `counter:tweet`, `counter:mention`) generate sequential IDs.

### Tweet lifecycle

Draft -> Queued -> Posted (to X via OAuth 1.0a). Each status transition is a PATCH to the tweet's status field.

## Styling

Plain CSS only (`globals.css`) — no Tailwind, no component library. Dark terminal aesthetic with CSS variables. Accent color is violet (`#8b5cf6`). Fonts: Space Grotesk (headings), Inter (body), JetBrains Mono (data/labels).

## Environment

Production requires Vercel KV env vars (`KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`). Local dev works without them via in-memory fallback. Agents are created via the setup wizard.

TypeScript strict mode is off. No linter is configured.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__Claude_in_Chrome__*` tools.

Available gstack skills:
- `/office-hours` - `/plan-ceo-review` - `/plan-eng-review` - `/plan-design-review`
- `/design-consultation` - `/review` - `/ship` - `/land-and-deploy`
- `/canary` - `/benchmark` - `/browse` - `/qa` - `/qa-only`
- `/design-review` - `/setup-browser-cookies` - `/setup-deploy` - `/retro`
- `/investigate` - `/document-release` - `/codex` - `/cso`
- `/careful` - `/freeze` - `/guard` - `/unfreeze` - `/gstack-upgrade`

If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.
