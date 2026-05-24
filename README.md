# Clawfable

AI autopilot for X accounts. Clawfable pilots an account as an authentic extension of its owner’s voice while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.

## How It Works

1. **Create an agent** — give it a name and connect your X account via OAuth
2. **Set the goal and voice** — write or generate a SOUL.md with the account objective, personality, tone, topic focus, and anti-goals
3. **Find live waves** — Clawfable reads account history, your follow graph, and trend candidates for relevant openings
4. **Draft + rank** — generate standalone posts weighted by voice fit, hot-take potential, topical relevance, and learned rewards
5. **Engage + learn** — queue or post originals, reply in voice to high-velocity threads, then feed outcomes back into the next batch

## Features

- **Setup wizard** — guided onboarding: connect X, define or generate SOUL.md, review the first batch, and launch when it feels right
- **Account analysis** — detects top-performing content formats (hot takes, short punches, observations, data points, etc.), extracts topic distribution, identifies viral tweets, and maps peak engagement hours
- **Autopilot control room** — shows queue health, learning state, safety caps, supervised engagement state, and the growth loop from trend discovery to ranking
- **Viral content generation** — produces standalone posts weighted toward your best-performing formats/topics, voice fit, hot-take potential, and bandit reward predictions
- **SOUL.md voice profiles** — define tone (contrarian, optimist, analyst, provocateur, educator) and topic focus via markdown
- **Post queue** — queue, edit, and batch-post tweets to X
- **Mentions & supervised replies** — view mentions, generate in-voice replies, and engage early with rising posts from followed accounts through the supervised Engage flow
- **Engagement metrics & learning** — track generated, queued, posted, engagement, follower growth, local evidence, and ranking decisions
- **Survivability guardrails** — original-post daily cap, jittered cadence, diversity checks, near-duplicate detection, and policy-risk scoring
- **Multi-agent support** — run multiple agents with independent X accounts, voices, and strategies

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create your first agent via the setup wizard.

## Project Structure

```
app/
  layout.tsx                — Root layout
  globals.css               — Warm creator-workspace CSS design system
  page.tsx                  — Public marketing page
  agent/[id]/page.tsx       — Agent dashboard shell
  api/
    agents/                 — CRUD for agents
    agents/[id]/connect/    — Connect X API keys (manual)
    agents/[id]/disconnect/ — Remove X API keys
    agents/[id]/analyze/    — Run account analysis
    agents/[id]/analysis/   — Get stored analysis results
    agents/[id]/dashboard/  — Batched dashboard snapshots
    agents/[id]/engage/     — Guided engagement sessions and draft replies
    agents/[id]/protocol/generate/ — Generate ranked standalone post candidates
    agents/[id]/protocol/run/      — Manually trigger one autopilot pass
    agents/[id]/topics/     — Trending topics
    agents/[id]/generate-tweet/  — Generate single tweet
    agents/[id]/generate-reply/  — Generate reply to mention
    agents/[id]/queue/      — Tweet queue management
    agents/[id]/twitter/    — Live X API (post, mentions, search, like)
    auth/twitter/           — OAuth 1.0a flow (initiate + callback)
  components/
    setup-wizard.tsx        — Agent onboarding
    setup-continuation.tsx  — Resume incomplete setup
    autopilot-tab.tsx       — Automation settings, growth loop, safety state, post log
    compose-tab.tsx         — Draft generation and ranking explanations
    engage-tab.tsx          — Guided engagement sessions
    queue-tab.tsx           — Post queue management
    mentions-tab.tsx        — Mentions inbox + reply generation
    insights-tab.tsx        — Learning and metrics switcher
    settings-tab.tsx        — Agent config, X API credentials, SOUL.md editor
lib/
  kv-storage.ts             — Vercel KV with in-memory fallback
  soul-parser.ts            — SOUL.md → voice profile (tone, topics, anti-goals)
  analysis.ts               — Account analyzer (formats, topics, virality, peak hours)
  viral-generator.ts        — Standalone post generation prompt builder
  candidate-ranking.ts      — Voice fit, risk, novelty, hot-take potential, and reward ranking
  proactive-engagement.ts   — Follow discovery, peer style study, and cross-agent shoutouts
  survivability.ts          — Cadence, daily cap, diversity, duplicate, and safety gates
  twitter-client.ts         — Stateless Twitter API client (serverless-safe)
  types.ts                  — TypeScript types
```

## Tech Stack

- **Next.js 16** App Router, TypeScript
- **Vercel KV** (Redis) with automatic in-memory fallback for local dev
- **twitter-api-v2** for X API integration
- **Plain CSS** — warm creator-workspace aesthetic, no Tailwind

## Environment

Production requires Vercel KV env vars:

```
KV_URL
KV_REST_API_URL
KV_REST_API_TOKEN
KV_REST_API_READ_ONLY_TOKEN
```

Local dev works without them — the app falls back to in-memory storage automatically.

X API connection is handled via OAuth 1.0a through the setup wizard — no manual key entry required.
