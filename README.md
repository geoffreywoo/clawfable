# Clawfable

AI agent fleet for Twitter. Create agents with unique voice profiles, analyze account performance, generate viral content, and post to X.

## How It Works

1. **Create an agent** — give it a name, connect your X account via OAuth
2. **Define its voice** — write a SOUL.md that defines personality, tone, and topic focus
3. **Analyze your account** — Clawfable reads your timeline to find what content performs best
4. **Generate + post** — produce format-matched, topic-weighted tweets and post them to X

## Features

- **Setup wizard** — guided 3-step onboarding: connect X, define SOUL.md, run account analysis
- **Account analysis** — detects top-performing content formats (hot takes, threads, questions, data points, etc.), extracts topic distribution, identifies viral tweets, and maps peak engagement hours
- **Protocol tab** — real-time dashboard showing engagement metrics, top formats/topics, following graph, and generated content feed
- **Viral content generation** — produces tweets weighted toward your best-performing formats and topics, with rationale for each
- **SOUL.md voice profiles** — define tone (contrarian, optimist, analyst, provocateur, educator) and topic focus via markdown
- **Post queue** — queue, edit, and batch-post tweets to X
- **Mentions & replies** — view mentions, generate in-voice replies, post back to X
- **Engagement metrics** — track tweets generated, posted, engagement rate, follower growth
- **Multi-agent** — run multiple agents with independent X accounts, voices, and strategies

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
  globals.css               — Dark terminal CSS design system
  page.tsx                  — Agent fleet landing page
  agent/[id]/page.tsx       — Agent dashboard (tabs: protocol, feed, queue, mentions, metrics, settings)
  api/
    agents/                 — CRUD for agents
    agents/[id]/connect/    — Connect X API keys (manual)
    agents/[id]/disconnect/ — Remove X API keys
    agents/[id]/analyze/    — Run account analysis
    agents/[id]/analysis/   — Get stored analysis results
    agents/[id]/protocol/generate/ — Generate viral tweets from analysis + SOUL.md
    agents/[id]/topics/     — Trending topics
    agents/[id]/generate-tweet/  — Generate single tweet
    agents/[id]/generate-reply/  — Generate reply to mention
    agents/[id]/queue/      — Tweet queue management
    agents/[id]/twitter/    — Live X API (post, mentions, search, like)
    auth/twitter/           — OAuth 1.0a flow (initiate + callback)
  components/
    setup-wizard.tsx        — 3-step agent onboarding
    setup-continuation.tsx  — Resume incomplete setup
    protocol-tab.tsx        — Analysis dashboard + content generation
    feed-tab.tsx            — Generated tweet feed
    queue-tab.tsx           — Post queue management
    mentions-tab.tsx        — Mentions inbox + reply generation
    metrics-tab.tsx         — Engagement metrics
    settings-tab.tsx        — Agent config, X API credentials, SOUL.md editor
lib/
  kv-storage.ts             — Vercel KV with in-memory fallback
  soul-parser.ts            — SOUL.md → voice profile (tone, topics, anti-goals)
  analysis.ts               — Account analyzer (formats, topics, virality, peak hours)
  viral-generator.ts        — Format-weighted tweet generation with rationale
  tweet-templates.ts        — 5 tone x 7 topic template matrix
  twitter-client.ts         — Stateless Twitter API client (serverless-safe)
  types.ts                  — TypeScript types
```

## Tech Stack

- **Next.js 16** App Router, TypeScript
- **Vercel KV** (Redis) with automatic in-memory fallback for local dev
- **twitter-api-v2** for X API integration
- **Plain CSS** — dark terminal aesthetic, no Tailwind

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
