/**
 * Viral content generator.
 * Produces tweets informed by the agent's soul profile, account analysis,
 * engagement patterns, and following context.
 */

import type { AccountAnalysis, ViralTweet } from './types';
import type { VoiceProfile } from './soul-parser';

// ─── Format templates ────────────────────────────────────────────────────────
// Each format mirrors patterns found in high-performing tweets

interface FormatTemplate {
  id: string;
  label: string;
  build: (ctx: GenerationContext) => string;
}

interface GenerationContext {
  tone: string;
  topics: string[];
  antiGoals: string[];
  style: string;
  viralTweets: ViralTweet[];
  topFormats: string[];
  topTopics: string[];
  topAccounts: Array<{ username: string; name: string }>;
  followingCategories: string[];
  viralThreshold: number;
  avgEngagement: number;
}

// ─── Structural patterns derived from viral tweet analysis ───────────────────

const OPENERS: Record<string, string[]> = {
  contrarian: [
    'Everyone is wrong about',
    'Unpopular truth:',
    'The consensus on {topic} is backwards.',
    'Nobody wants to hear this but',
    'The dirty secret about {topic}:',
    'Stop pretending that',
    '{topic} discourse is broken because',
  ],
  optimist: [
    'Massively underrated:',
    'The best part about {topic} that nobody talks about:',
    'Quietly, {topic} is about to change everything.',
    'Mark this tweet. In 18 months,',
    'The builders who understand {topic} right now are playing a different game.',
    'We are so early on {topic}.',
  ],
  analyst: [
    'Data point worth watching:',
    'The numbers on {topic} tell an interesting story.',
    'Breaking down the {topic} situation—',
    'Three things everyone is missing about {topic}:',
    'The real {topic} metric nobody is tracking:',
    `Here's what the {topic} data actually says:`,
  ],
  provocateur: [
    'Hot take:',
    'Hear me out—',
    'This is going to upset people but',
    'The {topic} emperor has no clothes.',
    `I'll say what everyone is thinking:`,
    'Controversial but true:',
    'The uncomfortable truth about {topic}:',
  ],
  educator: [
    `Most people misunderstand {topic}. Here's the mental model:`,
    'Quick explainer on {topic}—',
    '{topic} explained simply:',
    `If you're confused about {topic}, start here:`,
    'The key insight on {topic} that changed my thinking:',
    'Thread: What {topic} actually means for you.',
  ],
};

const STRUCTURES: Record<string, Array<(ctx: GenerationContext) => string>> = {
  hot_take: [
    (ctx) => {
      const opener = pickRandom(OPENERS[ctx.tone] || OPENERS.contrarian);
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return fillTopic(opener, topic) + ' ' + buildTakeBody(ctx, topic);
    },
  ],
  data_point: [
    (ctx) => {
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      const metric = pickRandom(['adoption', 'revenue', 'growth', 'engagement', 'market cap', 'funding']);
      return buildDataTweet(ctx, topic, metric);
    },
  ],
  question: [
    (ctx) => {
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return buildQuestionTweet(ctx, topic);
    },
  ],
  short_punch: [
    (ctx) => {
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return buildPunchTweet(ctx, topic);
    },
  ],
  thread_hook: [
    (ctx) => {
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return buildThreadHook(ctx, topic);
    },
  ],
  explainer: [
    (ctx) => {
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return buildExplainer(ctx, topic);
    },
  ],
  statement: [
    (ctx) => {
      const opener = pickRandom(OPENERS[ctx.tone] || OPENERS.contrarian);
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return fillTopic(opener, topic) + ' ' + buildTakeBody(ctx, topic);
    },
  ],
  structured: [
    (ctx) => {
      const topic = pickRandom(ctx.topTopics.length > 0 ? ctx.topTopics : ctx.topics);
      return buildStructuredTweet(ctx, topic);
    },
  ],
};

// ─── Tweet body builders ─────────────────────────────────────────────────────

const TAKE_BODIES: Record<string, string[]> = {
  contrarian: [
    'The people shouting loudest have the least skin in the game.',
    'Three years from now everyone will pretend they saw this coming.',
    'This is what happens when you optimize for metrics instead of outcomes.',
    'The signal-to-noise ratio in {topic} is approaching zero.',
    'Follow the incentives, not the announcements.',
    'The real story is what nobody is talking about.',
  ],
  optimist: [
    'The compounding effects here are going to be staggering.',
    'Early movers are quietly building the infrastructure for the next decade.',
    'This is the kind of shift that creates entire new categories.',
    `We're in the deployment phase now. The research phase was just the warm-up.`,
    'The gap between believers and skeptics is widening every month.',
  ],
  analyst: [
    'The underlying data suggests a more nuanced picture than the headlines.',
    'First-order effects are obvious. Second-order effects are where the real story is.',
    'The base rate for this kind of prediction is ~15% accuracy. Plan accordingly.',
    'Worth separating the trend from the cycle here. They tell different stories.',
    'Three variables matter. Everything else is noise.',
  ],
  provocateur: [
    'And nobody has the courage to say it out loud.',
    `The incentive structure guarantees this outcome. It's not even controversial.`,
    'This is going to age extremely well. Screenshot this.',
    `The people who disagree haven't done the math.`,
    'Wake me up when the narrative matches reality.',
  ],
  educator: [
    'The mental model that helps: think of it as compounding layers, not a single breakthrough.',
    `Most confusion comes from conflating two different things. Here's the distinction.`,
    'Once you understand the incentive structure, everything else makes sense.',
    'The key variable most people miss: the cost of being wrong vs. the cost of being slow.',
    `Here's the framework that actually helps you think about this clearly.`,
  ],
};

function buildTakeBody(ctx: GenerationContext, topic: string): string {
  const bodies = TAKE_BODIES[ctx.tone] || TAKE_BODIES.contrarian;
  return fillTopic(pickRandom(bodies), topic);
}

function buildDataTweet(ctx: GenerationContext, topic: string, metric: string): string {
  const openers: Record<string, string[]> = {
    contrarian: [
      `Everyone's celebrating {topic} ${metric} numbers. Nobody's asking where the denominator comes from.`,
      `{topic} ${metric} looks great if you don't adjust for survivorship bias. Most don't.`,
    ],
    optimist: [
      `The {topic} ${metric} trend is unmistakable. Up and to the right, month over month.`,
      `Quietly: {topic} ${metric} just crossed a threshold that historically precedes exponential acceleration.`,
    ],
    analyst: [
      `{topic} ${metric} data: the trend is real, but the magnitude is overstated by ~40% in most analysis.`,
      `Breaking down {topic} ${metric}: the top decile accounts for 70% of the movement. The median tells a different story.`,
    ],
    provocateur: [
      `The {topic} ${metric} numbers everyone's sharing? Cherry-picked. The full dataset tells a very different story.`,
      `{topic} ${metric} discourse is 90% vibes and 10% actual numbers. Here are the actual numbers.`,
    ],
    educator: [
      `How to read {topic} ${metric} correctly: the headline number is misleading. Here's what to look at instead.`,
      `{topic} ${metric} primer: three metrics that matter, and three that don't.`,
    ],
  };
  const pool = openers[ctx.tone] || openers.analyst;
  return fillTopic(pickRandom(pool), topic);
}

function buildQuestionTweet(ctx: GenerationContext, topic: string): string {
  const questions: Record<string, string[]> = {
    contrarian: [
      `Genuine question: if {topic} is so transformative, why hasn't the market moved?`,
      `What if the {topic} consensus is just survivorship bias at scale?`,
      `Has anyone actually measured the ROI on {topic}? Or are we just assuming?`,
    ],
    optimist: [
      `What's the most underrated application of {topic} that you're watching?`,
      `If {topic} compounds at current rates, what does the world look like in 3 years?`,
    ],
    analyst: [
      `What's the base rate for {topic} predictions actually being correct? I'd guess <20%.`,
      `Genuine question for people building in {topic}: what's your biggest bottleneck right now?`,
    ],
    provocateur: [
      `Hot question: is {topic} actually delivering or is it just a better-funded version of the last hype cycle?`,
      `If you can't explain {topic}'s value prop in one sentence, is it actually a value prop?`,
    ],
    educator: [
      `What's the biggest misconception about {topic} that you wish more people understood?`,
      `If you had to explain {topic} to a smart person outside the industry, what analogy would you use?`,
    ],
  };
  const pool = questions[ctx.tone] || questions.contrarian;
  return fillTopic(pickRandom(pool), topic);
}

function buildPunchTweet(ctx: GenerationContext, topic: string): string {
  const punches: Record<string, string[]> = {
    contrarian: [
      `{topic} is just {topic} with better marketing.`,
      `Your {topic} moat is a subscription.`,
      `{topic} hot take: it's 2024 all over again.`,
    ],
    optimist: [
      `{topic} is working. The numbers don't lie.`,
      `Bet on {topic} builders. Ignore {topic} pundits.`,
    ],
    analyst: [
      `{topic}: overhyped short-term, underpriced long-term.`,
      `The {topic} signal is there. You have to know where to look.`,
    ],
    provocateur: [
      `{topic} is a religion now. Complete with heretics and true believers.`,
      `{topic} peaked. Nobody wants to say it. I'll say it.`,
    ],
    educator: [
      `{topic} in one sentence: it's about leverage, not intelligence.`,
      `The simplest {topic} take is usually the most correct one.`,
    ],
  };
  const pool = punches[ctx.tone] || punches.contrarian;
  return fillTopic(pickRandom(pool), topic);
}

function buildThreadHook(ctx: GenerationContext, topic: string): string {
  const hooks: Record<string, string[]> = {
    contrarian: [
      `I spent the last week analyzing {topic} data.\n\nThe narrative is wrong. Here's what's actually happening:`,
      `Everyone is talking about {topic}.\n\nAlmost everyone is wrong.\n\nHere's the contrarian case:`,
    ],
    optimist: [
      `I've been tracking {topic} for 6 months.\n\nThe progress is staggering. Here's what I'm seeing:`,
      `{topic} is having a moment.\n\nBut it's not hype — it's compounding progress.\n\nLet me show you:`,
    ],
    analyst: [
      `Did a deep dive into {topic} this week.\n\nThe data is more interesting than the takes.\n\nBreakdown:`,
      `Three charts that tell the real {topic} story.\n\nNone of them are the ones you've been seeing:`,
    ],
    provocateur: [
      `Time for an uncomfortable {topic} thread.\n\nThe industry won't like this.\n\nBut someone has to say it:`,
      `I'm going to explain why {topic} is simultaneously overhyped and underpriced.\n\nBuckle up:`,
    ],
    educator: [
      `{topic} explained from first principles.\n\nEverything you need to know, no jargon:\n\n↓`,
      `The beginner's guide to {topic} that I wish existed.\n\nHere's my attempt:`,
    ],
  };
  const pool = hooks[ctx.tone] || hooks.contrarian;
  return fillTopic(pickRandom(pool), topic);
}

function buildExplainer(ctx: GenerationContext, topic: string): string {
  const explainers: Record<string, string[]> = {
    contrarian: [
      `Everyone's explaining {topic} wrong.\n\nThe real mechanism is simpler and less flattering:`,
      `The standard {topic} explanation is comforting but wrong. Here's the uncomfortable version:`,
    ],
    optimist: [
      `Let me explain why {topic} is about to change more than people expect.\n\nThe key insight most miss:`,
      `{topic} is often explained as incremental progress. It's actually a phase change. Here's why:`,
    ],
    analyst: [
      `{topic} in context: what the numbers say vs. what the narrative says. They diverge at a critical point.`,
      `A clear-eyed look at {topic}: the signal, the noise, and what to actually pay attention to.`,
    ],
    provocateur: [
      `Let me explain {topic} in a way that will make both sides mad.\n\nThat usually means it's accurate:`,
      `The honest {topic} explainer: what everyone gets right, what everyone gets wrong, and why.`,
    ],
    educator: [
      `{topic} is confusing because people mix up three different things.\n\nHere's the clean separation:`,
      `The mental model for {topic} that actually works:\n\nForget everything else — start here.`,
    ],
  };
  const pool = explainers[ctx.tone] || explainers.educator;
  return fillTopic(pickRandom(pool), topic);
}

function buildStructuredTweet(ctx: GenerationContext, topic: string): string {
  const templates: Record<string, string[]> = {
    contrarian: [
      `{topic} reality check:\n\n- The bull case is well-known\n- The bear case is ignored\n- The actual case is somewhere nobody is looking\n\nFollow the incentives, not the headlines.`,
    ],
    optimist: [
      `Why I'm long {topic}:\n\n- The infrastructure is maturing fast\n- Builders are shipping real things\n- The compounding hasn't started yet\n\nWe are so early.`,
    ],
    analyst: [
      `{topic} scorecard:\n\n- Hype: overheated\n- Fundamentals: quietly strong\n- Timing: earlier than consensus thinks\n- Risk: concentrated, not systemic\n\nPosition accordingly.`,
    ],
    provocateur: [
      `{topic} truth table:\n\n- What they say: revolutionary\n- What it is: iterative\n- What they want: your money\n- What you should do: wait 6 months\n\nYou're welcome.`,
    ],
    educator: [
      `{topic} simplified:\n\n1. What it does: [one thing]\n2. Why it matters: [one reason]\n3. What to watch: [one metric]\n4. What to ignore: [everything else]\n\nComplexity is not sophistication.`,
    ],
  };
  const pool = templates[ctx.tone] || templates.analyst;
  return fillTopic(pickRandom(pool), topic);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTopic(template: string, topic: string): string {
  return template.replace(/\{topic\}/g, topic);
}

// ─── Main generation function ────────────────────────────────────────────────

export interface ProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
}

export function generateViralTweet(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis
): ProtocolTweet {
  const ctx: GenerationContext = {
    tone: voiceProfile.tone,
    topics: voiceProfile.topics,
    antiGoals: voiceProfile.antiGoals,
    style: voiceProfile.communicationStyle,
    viralTweets: analysis.viralTweets,
    topFormats: analysis.engagementPatterns.topFormats,
    topTopics: analysis.engagementPatterns.topTopics,
    topAccounts: analysis.followingProfile.topAccounts.map((a) => ({
      username: a.username,
      name: a.name,
    })),
    followingCategories: analysis.followingProfile.categories.map((c) => c.label),
    viralThreshold: analysis.engagementPatterns.viralThreshold,
    avgEngagement: analysis.engagementPatterns.avgLikes,
  };

  // Pick format — weight toward formats that performed well for this account
  const preferredFormats = analysis.engagementPatterns.topFormats;
  const allFormats = Object.keys(STRUCTURES);
  const format = preferredFormats.length > 0 && Math.random() < 0.7
    ? pickRandom(preferredFormats.filter((f) => STRUCTURES[f]))
    : pickRandom(allFormats);

  const safeFormat = STRUCTURES[format] ? format : 'hot_take';
  const builders = STRUCTURES[safeFormat];
  const builder = pickRandom(builders);
  let content = builder(ctx);

  // Trim to 280 chars if needed
  if (content.length > 280) {
    content = content.slice(0, 277) + '...';
  }

  // Pick the topic that was used
  const targetTopic = ctx.topTopics.length > 0 ? pickRandom(ctx.topTopics) : pickRandom(ctx.topics);

  const rationale = buildRationale(safeFormat, targetTopic, analysis);

  return { content, format: safeFormat, targetTopic, rationale };
}

export function generateViralBatch(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  count: number
): ProtocolTweet[] {
  const tweets: ProtocolTweet[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count * 3 && tweets.length < count; i++) {
    const tweet = generateViralTweet(voiceProfile, analysis);
    // Deduplicate by first 50 chars
    const key = tweet.content.slice(0, 50);
    if (!seen.has(key)) {
      seen.add(key);
      tweets.push(tweet);
    }
  }

  return tweets;
}

function buildRationale(format: string, topic: string, analysis: AccountAnalysis): string {
  const parts: string[] = [];
  const patterns = analysis.engagementPatterns;

  if (patterns.topFormats.includes(format)) {
    parts.push(`"${format}" is a top-performing format for this account`);
  }
  if (patterns.topTopics.includes(topic)) {
    parts.push(`"${topic}" drives above-average engagement`);
  }
  if (patterns.avgLikes > 0) {
    parts.push(`targeting ${patterns.viralThreshold}+ likes (3x the ${patterns.avgLikes} avg)`);
  }

  return parts.length > 0 ? parts.join('; ') + '.' : 'Generated based on soul profile and engagement analysis.';
}
