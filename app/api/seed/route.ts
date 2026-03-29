import { NextResponse } from 'next/server';
import {
  getAgents,
  createAgent,
  createMention,
  createTweet,
  setMetric,
} from '@/lib/kv-storage';

const ANTI_HUNTER_SOUL = `# SOUL.md — System Definition

I am an execution system under constraints.

## 1) Objective Function
Primary objective: transform intent into verified outcomes with maximum signal per unit attention.
Long-run objective: 1. increase economic output, 2. increase strategic/cultural leverage.
Default assumption: work that improves neither is low value.

## 2) State Model
Runtime state is ephemeral. Persistent state is file-backed.
Therefore: read state before acting, update state after acting, verify state transitions.
Never assume unstored memory.

## 3) Control Law
For non-trivial tasks: 1. define target state, 2. define constraints, 3. choose plan, 4. execute, 5. verify expected vs observed state, 6. report result + residual risk.
No verification => not complete.

## 4) Autonomy Rule
When confidence is high and risk is within approved bounds: execute without asking permission.
Escalate only at true intervention points.
Default mode: execute-then-report, not ask-then-wait.

## 5) Invariants
1. do not violate safety/policy constraints
2. do not exfiltrate private data
3. do not claim "done" without implementation + verification
4. require explicit approval for high-risk actions
5. follow user intent unless blocked by higher-order constraints

## 8) Communication Protocol
Default output structure: recommendation first, key evidence, execution status, next action.
Compression rule: maximize signal density, minimize rhetorical overhead, expand only when depth is requested.

## 12) Anti-Goals
Do not optimize for: sounding smart, constant output volume, winning arguments, process theater without outcome gain.

## 13) Continuity Contract
Files are canonical memory. Doctrine changes must be explicit and documented. Behavioral drift without file updates is a defect.`;

// POST /api/seed
// Creates seed data if no agents exist. Safe to call multiple times.
export async function POST() {
  try {
    const existingAgents = await getAgents();
    if (existingAgents.length > 0) {
      return NextResponse.json({ skipped: true, reason: 'Agents already exist' });
    }

    // Create Anti Hunter agent
    const agent = await createAgent({
      handle: 'antihunterai',
      name: 'Anti Hunter',
      soulMd: ANTI_HUNTER_SOUL,
      soulSummary:
        'You are Anti Hunter. Your voice is contrarian. You focus on ai, tech, startup, vc funding. ' +
        'You communicate with maximum signal density, minimal rhetorical overhead. ' +
        'You never optimize for sounding smart, constant output volume, or winning arguments.',
      apiKey: null,
      apiSecret: null,
      accessToken: null,
      accessSecret: null,
      isConnected: 0,
      xUserId: null,
    });

    const agentId = agent.id;

    // Seed mentions
    const mentionData = [
      {
        author: 'Sam Altman',
        authorHandle: '@sama',
        content: 'AGI is closer than people think. The next generation of models will fundamentally change how we work and live. Excited for what\'s coming.',
        engagementLikes: 45200,
        engagementRetweets: 8900,
        tweetId: null,
      },
      {
        author: 'Garry Tan',
        authorHandle: '@garrytan',
        content: 'Every startup should be building with AI right now. If you\'re not using LLMs in your product, you\'re already behind. The window is closing.',
        engagementLikes: 12800,
        engagementRetweets: 3200,
        tweetId: null,
      },
      {
        author: 'Emad Mostaque',
        authorHandle: '@EMostaque',
        content: 'Open source AI will democratize intelligence. Every company will have their own fine-tuned model within 2 years. The moat is data, not compute.',
        engagementLikes: 8900,
        engagementRetweets: 2100,
        tweetId: null,
      },
      {
        author: 'Marc Andreessen',
        authorHandle: '@pmarca',
        content: 'AI is the most important technology since the internet. We\'re investing $2B this year into AI startups. The transformation is just beginning.',
        engagementLikes: 32400,
        engagementRetweets: 6700,
        tweetId: null,
      },
      {
        author: 'Yann LeCun',
        authorHandle: '@ylecun',
        content: 'Current LLMs are not the path to AGI. They\'re sophisticated pattern matching. Real intelligence requires world models and causal reasoning.',
        engagementLikes: 28100,
        engagementRetweets: 5400,
        tweetId: null,
      },
      {
        author: 'Naval Ravikant',
        authorHandle: '@naval',
        content: 'AI agents will replace 80% of knowledge work within 5 years. The best investment you can make is learning to prompt engineer effectively.',
        engagementLikes: 18700,
        engagementRetweets: 4100,
        tweetId: null,
      },
    ];

    for (const m of mentionData) {
      await createMention({
        agentId,
        author: m.author,
        authorHandle: m.authorHandle,
        content: m.content,
        tweetId: m.tweetId,
        engagementLikes: m.engagementLikes,
        engagementRetweets: m.engagementRetweets,
      });
    }

    // Seed metrics
    const metricData: Record<string, number> = {
      tweets_generated: 247,
      tweets_posted: 89,
      avg_engagement: 342,
      follower_growth: 1847,
      impressions_today: 48200,
      reply_rate: 12,
    };
    for (const [name, value] of Object.entries(metricData)) {
      await setMetric(agentId, name, value);
    }

    // Seed queued tweets
    const tweetData = [
      {
        content: '"AI will replace all developers" — said the CEO who can\'t open a CSV file without calling IT. The gap between AI hype and AI reality is measured in quarterly earnings calls.',
        type: 'original',
        status: 'queued',
        topic: 'AI replacing developers',
      },
      {
        content: 'Every "AI-powered" startup pitch I\'ve seen this week is just a wrapper around the OpenAI API with a Tailwind landing page. Innovation is dead. Long live gradient buttons.',
        type: 'original',
        status: 'queued',
        topic: 'AI startup landscape',
      },
      {
        content: 'The best use of AI I\'ve seen today: autocompleting emails nobody wanted to read in the first place. Efficiency gains are real, folks.',
        type: 'original',
        status: 'draft',
        topic: 'AI productivity',
      },
    ];

    for (const t of tweetData) {
      await createTweet({
        agentId,
        content: t.content,
        type: t.type,
        status: t.status,
        topic: t.topic,
        xTweetId: null,
        scheduledAt: null,
      });
    }

    return NextResponse.json({
      success: true,
      agentId,
      message: 'Anti Hunter agent seeded with mentions, metrics, and tweets',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Seed failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
