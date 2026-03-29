# Clawfable — Multi-Agent Twitter Bot Ops Platform

A Next.js 14+ App Router platform for managing multiple Twitter bot agents, each with a unique SOUL.md personality profile and live X API integration.

## Overview

Clawfable lets you create, configure, and operate Twitter bots — each with its own voice, tone, and topic focus defined via a markdown SOUL.md file. Generate on-brand tweets, manage a post queue, respond to mentions, and track engagement metrics.

## Features

- **Multi-agent management** — create and manage unlimited Twitter bot agents
- **SOUL.md voice profiles** — define tone (contrarian, optimist, analyst, provocateur, educator) and topic focus
- **Tweet generation** — generate on-voice takes for trending AI/tech topics
- **Post queue** — queue, edit, and batch-post tweets to X
- **Mentions & replies** — view mentions, generate in-voice replies, post back to X
- **Engagement metrics** — track tweets generated, posted, engagement rate, follower growth
- **Live X API integration** — connect per-agent OAuth 1.0a credentials to post live

## Tech Stack

- **Framework:** Next.js 14+ App Router (TypeScript)
- **Storage:** Vercel KV (Redis-compatible) with in-memory fallback for local dev
- **Twitter API:** `twitter-api-v2`
- **Fonts:** Space Grotesk (headings) · Inter (body) · JetBrains Mono (data/labels)
- **Styling:** Plain CSS with dark terminal aesthetic (no Tailwind, no shadcn/ui)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The seed data (Anti Hunter agent) will be created automatically on first load.

## Project Structure

```
app/
  layout.tsx              — Root layout
  globals.css             — Dark terminal CSS design system
  page.tsx                — Agent list landing page
  agent/[id]/page.tsx     — Agent dashboard (tabs: feed, queue, mentions, metrics, settings)
  api/
    agents/route.ts       — GET list + POST create
    agents/[id]/route.ts  — GET + PATCH + DELETE agent
    agents/[id]/connect/  — POST: connect X API keys
    agents/[id]/disconnect/— POST: remove keys
    agents/[id]/topics/   — GET: trending topics
    agents/[id]/generate-tweet/ — POST: generate tweet
    agents/[id]/generate-reply/ — POST: generate reply
    agents/[id]/queue/    — GET + POST queue
    agents/[id]/queue/[tweetId]/ — PATCH + DELETE tweet
    agents/[id]/mentions/ — GET stored mentions
    agents/[id]/metrics/  — GET metrics
    agents/[id]/twitter/post/    — POST: post to X live
    agents/[id]/twitter/mentions/— GET: fetch from X
    agents/[id]/twitter/search/  — GET: search X
    agents/[id]/twitter/like/    — POST: like tweet
    seed/route.ts         — POST: seed demo data
  components/
    logo.tsx, agent-card.tsx, agent-create-modal.tsx
    feed-tab.tsx, queue-tab.tsx, mentions-tab.tsx
    metrics-tab.tsx, settings-tab.tsx
lib/
  types.ts         — TypeScript types
  kv-storage.ts    — Vercel KV storage layer
  soul-parser.ts   — SOUL.md parser
  twitter-client.ts— Twitter API client (stateless/serverless)
  tweet-templates.ts— 5 voice × 7 topic template matrix
```

## Vercel KV Setup

Set these environment variables in your Vercel project:

```
KV_URL
KV_REST_API_URL
KV_REST_API_TOKEN
KV_REST_API_READ_ONLY_TOKEN
```

In local dev without KV credentials, the app falls back to an in-memory store automatically.

## X API Setup

For each agent, you need OAuth 1.0a credentials with Read + Write permissions:

1. Go to [developer.x.com](https://developer.x.com)
2. Create an app with User Authentication (OAuth 1.0a)
3. Set Read + Write permissions
4. Copy: API Key, API Secret, Access Token, Access Token Secret
5. Enter these in the agent's Settings tab → X API Credentials

## Design System

Dark terminal aesthetic:
- Background: `#0a0a0a`
- Surface: `#141414`
- Accent: `#dc2626` (crimson red)
- Primary text: `#e5e5e5`
- Muted text: `#737373`
- Fonts: Space Grotesk / Inter / JetBrains Mono
