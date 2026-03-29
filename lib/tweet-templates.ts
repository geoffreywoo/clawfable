/**
 * Tweet generation templates — full voice × topic matrix.
 * Ported from routes-ref.ts.
 */

type TopicKey = 'openai' | 'google' | 'regulation' | 'funding' | 'agents' | 'jobs' | 'default';

const TEMPLATES: Record<string, Record<TopicKey, string[]>> = {
  contrarian: {
    openai: [
      `OpenAI announces yet another thing they'll ship "soon." Their roadmap is a masterclass in vaporware with good lighting.`,
      `OpenAI's business model: charge developers $20/mo to beta test products that break every Tuesday. Disruption.`,
      `Sam Altman saying AGI is close is like a contractor saying "two more weeks." It's always two more weeks.`,
      `OpenAI's latest demo is impressive until you try to use it in production. Then it's just expensive autocomplete.`,
    ],
    google: [
      `Google adding AI to Search is like putting a spoiler on a minivan. It doesn't make it faster, it just looks desperate.`,
      `Google killed another product today. But don't worry — they're definitely committed to this AI thing. For now.`,
      `Gemini is Google's answer to a question nobody asked, built by a committee that can't ship a messaging app.`,
      `Google has 10,000 researchers and still ships products that feel like an intern's side project. Remarkable.`,
    ],
    regulation: [
      `AI regulation debate: one side wants to ban math, the other wants zero rules. Both are wrong. Both are loud.`,
      `Congress regulating AI is like your grandpa configuring the Wi-Fi router. Good intentions. Zero understanding.`,
      `The EU's AI Act is 500 pages of bureaucracy that will stop exactly zero bad actors and slow down every startup.`,
      `Regulators want to regulate AI they don't understand. At least they're consistent — same approach as crypto.`,
    ],
    funding: [
      `Another AI startup raised $100M at a $1B valuation with zero revenue. The only intelligence here is artificial.`,
      `VC funding for AI is just wealth transfer from LPs to cloud compute providers. AWS is the real winner.`,
      `$10B in AI funding this quarter. $9.5B of it is going to companies that are GPT wrappers. Math checks out.`,
      `A16Z invested in another AI company. The pitch deck had "10x" in it 47 times. Performance art at scale.`,
    ],
    agents: [
      `"AI agents" are just if-else statements with delusions of grandeur. Your agent is a script, bro.`,
      `Every AI agent demo: works perfectly on stage, crashes in production, gets funded anyway. The circle of hype.`,
      `The gap between "AI agent" demos and "AI agent" reality is roughly the size of the Grand Canyon.`,
      `"Agentic AI" is the new "blockchain use case" — theoretical upside, practical chaos, great conference talks.`,
    ],
    jobs: [
      `"AI will replace all jobs" — said by people whose job is making predictions that never come true.`,
      `Companies replacing workers with AI, then hiring twice as many people to fix what the AI broke. Efficiency.`,
      `The only job AI has reliably replaced so far is "person who writes first drafts nobody reads."`,
      `McKinsey says AI will automate 30% of work. McKinsey also said offshoring would transform everything. Checks out.`,
    ],
    default: [
      `Another day, another "revolutionary AI product" that's just autocomplete with a marketing budget. The bar is underground.`,
      `If your AI startup's moat is "we have an API key," you don't have a moat. You have a subscription.`,
      `The AI hype cycle is just crypto with better PR. Same vibes, different tokens.`,
      `"We're building AGI" is the new "we're disrupting." Means nothing. Ships nothing. Raises everything.`,
      `Hot take: 90% of "AI engineers" are prompt copy-pasters with LinkedIn Premium. The other 10% are terrified.`,
      `VCs funding AI wrappers is like funding restaurants because they use electricity. The infrastructure isn't the innovation.`,
      `Every company adding "AI" to their name is the 2024 version of adding ".com" in 1999. We know how that ended.`,
      `The most honest AI demo would just show someone copy-pasting from ChatGPT and pretending they wrote it.`,
    ],
  },
  optimist: {
    openai: [
      `OpenAI just shipped something genuinely useful. The pace of improvement here is staggering — and we're still early.`,
      `Every OpenAI release is a reminder: we're living through the most productive period in AI history. Buckle up.`,
      `GPT-5 is here and it's a step-change. The people dismissing this haven't seen what builders will do with it.`,
    ],
    google: [
      `Google's AI push is creating real competition. More competition = faster progress for everyone. Genuinely bullish.`,
      `Gemini is better than critics admit. When big players take AI seriously, the whole ecosystem benefits.`,
      `Google has resources to solve problems nobody else can. Their AI work deserves more credit than it gets.`,
    ],
    regulation: [
      `Smart AI regulation is possible if we get the right people in the room. The conversation is finally happening.`,
      `Thoughtful frameworks for AI could actually accelerate adoption by building the trust enterprises need.`,
      `Regulation isn't the enemy of innovation — it's the infrastructure that makes scale possible.`,
    ],
    funding: [
      `Record AI investment means more talent, more tools, more infrastructure. Rising tide lifts all boats.`,
      `Yes, there's froth. But the underlying infrastructure being built will outlast any bubble by decades.`,
      `$100M into AI startups today funds the foundational tooling that every developer will use in 5 years.`,
    ],
    agents: [
      `AI agents are going to unlock productivity gains we can barely imagine. We're in the Wright Brothers era.`,
      `The first generation of AI agents is rough. The second generation will eat entire categories of software.`,
      `Agentic AI is real and it's going to compound. The demos look bad now. The 2026 version will look insane.`,
    ],
    jobs: [
      `Every major technology shift created more jobs than it destroyed. AI will be no different — just faster.`,
      `AI won't replace humans. It'll replace humans doing repetitive work, freeing them for higher-leverage tasks.`,
      `The best developers in 5 years will be the ones who learned to work with AI, not against it.`,
    ],
    default: [
      `We are living through the most significant technological acceleration in human history. Act accordingly.`,
      `The builders shipping with AI today are playing a different game than everyone else. The gap is widening.`,
      `Most people are underestimating how much better AI tools will get in the next 18 months. Drastically.`,
      `AI is compressing decades of progress into years. The people who understand this are quietly winning.`,
      `The defeatist narrative around AI is wrong. This is a generational opportunity and most people are sleeping on it.`,
    ],
  },
  analyst: {
    openai: [
      `OpenAI's Q4 metrics tell an interesting story: revenue growth outpacing cost reduction by ~2:1. Sustainable? Unclear.`,
      `The OpenAI/Microsoft relationship is worth watching. Dependency cuts both ways — for both parties.`,
      `Evaluating OpenAI objectively: best developer ecosystem, shakiest governance, unclear path to profitability.`,
    ],
    google: [
      `Google's AI revenue contribution remains low relative to search. The transition risk is real but manageable.`,
      `Gemini vs GPT-4: on coding tasks GPT-4 wins; on multimodal Gemini closes the gap. Context matters.`,
      `The Google AI story is a tale of two companies: DeepMind (excellent research) and Google AI (product struggles).`,
    ],
    regulation: [
      `Analyzing AI regulation across jurisdictions: EU is prescriptive, US is sector-based, UK is adaptive. Different risk profiles.`,
      `The economic cost of AI regulation vs. the cost of unregulated AI deployment — both have real downside scenarios.`,
      `Evidence-based AI policy requires better data than we currently have. We're regulating with incomplete information.`,
    ],
    funding: [
      `AI investment is concentrating: top 10 companies received 68% of all AI funding in 2024. Consolidation risk rising.`,
      `Breaking down the AI funding math: $50B in, ~$8B in revenue. The rest is infrastructure and expectations.`,
      `Historical comparison: AI investment curves are tracking closer to internet 1999 than cloud 2010. Note the difference.`,
    ],
    agents: [
      `Agent success rates on real tasks: ~40% on well-defined problems, ~12% on open-ended ones. Still early.`,
      `The agent architecture question matters: tool-use vs. fine-tuning vs. RAG have very different cost/accuracy tradeoffs.`,
      `Three bottlenecks for agent deployment: reliability, cost per task, and integration complexity. None are solved.`,
    ],
    jobs: [
      `Labor market data shows AI is augmenting productivity in knowledge work, not yet replacing it at scale.`,
      `The jobs-at-risk analysis requires sector specificity. Accounting: high risk. Plumbing: effectively zero risk.`,
      `AI productivity gains are real but unevenly distributed. Early adopters are seeing 30-40% efficiency gains.`,
    ],
    default: [
      `The gap between AI benchmark performance and real-world deployment performance remains large. Worth tracking.`,
      `AI capability is improving faster than AI alignment. That's not inherently bad — but it's the key variable to watch.`,
      `Three underreported AI trends: compute efficiency gains, smaller model performance, enterprise adoption rates.`,
      `The honest AI performance picture: exceptional on well-defined tasks, unreliable on novel ones. Plan accordingly.`,
      `Separating AI signal from noise requires longitudinal data. Most takes are based on single data points.`,
    ],
  },
  provocateur: {
    openai: [
      `Hot take: OpenAI is one bad quarter away from a governance crisis that makes 2023 look like a warmup.`,
      `OpenAI's real product isn't the models — it's Sam Altman's ability to raise money. Everything else is a feature.`,
      `The OpenAI/safety narrative is the most sophisticated marketing operation in Silicon Valley history. Change my mind.`,
    ],
    google: [
      `Google is going to lose the AI war and nobody in Mountain View has internalized this yet. That's the actual story.`,
      `Unpopular opinion: Google Brain + DeepMind merger was bureaucratic self-harm dressed up as strategy.`,
      `Google's AI problem isn't technology. It's that their incentive structure actively punishes shipping things that work.`,
    ],
    regulation: [
      `The AI safety community and the AI regulation community have almost nothing in common. Conflating them is lazy thinking.`,
      `AI regulation will create a permanent two-tier market: compliant incumbents and offshore non-compliant competitors. Neither wins.`,
      `Hot take: most "AI risk" discourse is class warfare by knowledge workers trying to protect their jobs. Said it.`,
    ],
    funding: [
      `The AI bubble isn't a bubble — it's a deliberate wealth transfer from late-stage LPs to cloud providers. Follow the money.`,
      `Unpopular: most AI startups aren't building companies. They're building acquisition targets. The acquirers know this too.`,
      `The real AI investment story: Nvidia is the only company definitively winning. Everything else is noise.`,
    ],
    agents: [
      `Nobody shipping AI agents in production will tell you they work reliably. The gap between demo and deploy is enormous.`,
      `AI agent hype is reaching levels that will cause real damage when the failure rate becomes impossible to ignore.`,
      `Hot take: AI agents are making developers worse by hiding complexity they should understand. Abstraction is a trap.`,
    ],
    jobs: [
      `The people most confident AI won't take their jobs are exactly the people most vulnerable to AI taking their jobs.`,
      `Unpopular: AI is already replacing junior knowledge workers. The market just hasn't priced in the lag yet.`,
      `The "AI augments, not replaces" narrative is cope for people who haven't run the unit economics.`,
    ],
    default: [
      `Unpopular opinion: the AI industry's biggest problem is that the people building it have never failed publicly.`,
      `Hot take: we're in a period of AI theater — impressive demos, mediocre production systems, extraordinary valuations.`,
      `The real AI story isn't capabilities. It's who controls the infrastructure. And that race is already over.`,
      `Most AI researchers have never shipped a product. Most product people have never read a paper. This gap is why AI sucks in prod.`,
      `Unpopular: the AI safety debate is dominated by people with no skin in the game on either side.`,
    ],
  },
  educator: {
    openai: [
      `Thread: How OpenAI's architecture actually works (non-technical). It's not magic — here's the 3-layer breakdown.`,
      `OpenAI's pricing model explained: you pay per token, tokens ≈ word-pieces, a 1K-word essay costs ~$0.002. Context matters.`,
      `What "GPT" actually means: Generative Pre-trained Transformer. Each word explains a design choice worth understanding.`,
    ],
    google: [
      `The difference between Google Search AI and Google Gemini: one retrieves, one generates. They fail in opposite ways.`,
      `Explainer: Why Google has a harder AI challenge than OpenAI. It's about business model constraints, not talent.`,
      `Understanding Gemini's multimodal design: how it processes text, images, and audio together — and why that's hard.`,
    ],
    regulation: [
      `AI regulation explainer: the EU, US, and UK approaches have fundamentally different assumptions. Here's a comparison.`,
      `What "high-risk AI" means under EU law — and why most people building AI have no idea if they're in scope.`,
      `The difference between AI regulation and AI governance: one is legal, one is operational. Both matter. Neither is sufficient alone.`,
    ],
    funding: [
      `How AI startup valuations work: revenue multiples vs. capability bets. The math is different from normal SaaS.`,
      `VC thesis 101: Why investors fund AI startups with no revenue. The expected value calculation explained simply.`,
      `Series A AI round anatomy: what investors are actually buying vs. what the pitch says they're buying.`,
    ],
    agents: [
      `AI agents explained simply: they're models that can take actions, not just generate text. Three components: planner, memory, tools.`,
      `Why AI agents fail in production: compounding error rates. If each step is 90% accurate, 10 steps = 35% success.`,
      `The four agent architectures compared: ReAct, Plan-and-Execute, Reflection loops, Multi-agent. When to use each.`,
    ],
    jobs: [
      `AI and jobs — an honest breakdown: which tasks are vulnerable (rule-based, high-volume) vs. which aren't (judgment, relationship).`,
      `How to evaluate your job's AI exposure: the key question isn't "can AI do this" — it's "what's the cost of AI doing this wrong."`,
      `The productivity gain math: if AI saves you 2h/day, that's 500 hours/year. What would you do with 500 extra hours?`,
    ],
    default: [
      `AI literacy gap: most people use AI tools daily without understanding how they work. Here's the 5-minute model.`,
      `Explaining LLMs without jargon: they're pattern completion engines trained on compressed internet text. That's mostly it.`,
      `The difference between AI, ML, and deep learning — and why the distinction actually matters for your decisions.`,
      `Prompt engineering explained: you're not coding, you're communicating. But you have to communicate with a very specific kind of mind.`,
      `Why AI hallucinates: it's not a bug, it's an emergent property of how the models are trained. Here's the mechanism.`,
    ],
  },
};

// ─── Reply templates ──────────────────────────────────────────────────────────

const REPLY_TEMPLATES: Record<string, Array<(handle: string) => string>> = {
  contrarian: [
    (h) => `Respectfully ${h}, this is the kind of take that sounds profound at a conference but evaporates under 30 seconds of scrutiny.`,
    (h) => `${h} This is what happens when you optimize for engagement over accuracy. The timeline isn't reality.`,
    (h) => `${h} Tell me you've never shipped a production system without telling me you've never shipped a production system.`,
    (h) => `Counterpoint ${h}: this only works if you ignore every lesson from the last 3 tech hype cycles. Which, to be fair, is the default.`,
    (h) => `${h} Bold claim. Now show the benchmarks on real-world data, not cherry-picked demos. I'll wait.`,
    (h) => `${h} The confidence-to-evidence ratio here is off the charts. Peak tech Twitter.`,
    (h) => `This take from ${h} is exactly why the AI industry has a credibility problem. More signal, less noise.`,
    (h) => `${h} Spoken like someone who's raised a round but never debugged a hallucination in prod at 3am.`,
  ],
  optimist: [
    (h) => `${h} is onto something real here. The pace of progress makes skeptics look wrong every 6 months.`,
    (h) => `Agree with ${h} — the people betting against this are going to look back and wonder why.`,
    (h) => `${h} this is exactly the right framing. Build first, critique later.`,
    (h) => `Strong take from ${h}. The optimists have been right more often than not on AI timelines.`,
  ],
  analyst: [
    (h) => `${h} the framing is interesting but the data doesn't quite support that conclusion. What's the sample size?`,
    (h) => `Worth nuancing ${h}'s point — the correlation is real but causation is harder to establish here.`,
    (h) => `${h} this is accurate on average but breaks down at the tails. The distribution matters.`,
    (h) => `Partially right ${h} — the first-order effect is as described, but the second-order is the more interesting question.`,
  ],
  provocateur: [
    (h) => `${h} is saying the quiet part loud, which I respect, but the conclusion doesn't follow from the premise.`,
    (h) => `Hot take: ${h}'s hot take is actually a cold take in disguise. The real thesis is buried.`,
    (h) => `${h} I'll go further: this is even worse than you're suggesting and nobody wants to say it.`,
    (h) => `${h} would be right if we were living in 2022. We're not. Update the priors.`,
  ],
  educator: [
    (h) => `${h} raises an important point — let me add some context that might help frame this better.`,
    (h) => `Building on what ${h} said: the mechanism here is actually worth understanding in detail.`,
    (h) => `${h} is correct and it's worth explaining *why* for people who haven't dug into the literature.`,
    (h) => `Good question embedded in ${h}'s post. Here's the clearest breakdown I can offer.`,
  ],
};

// ─── Trending topics (static list) ───────────────────────────────────────────

export const TRENDING_TOPICS = [
  { id: 1, headline: "OpenAI Announces GPT-5 with 'Unprecedented Reasoning Capabilities'", source: 'TechCrunch', relevanceScore: 98, category: 'openai', timestamp: new Date(Date.now() - 1800000).toISOString() },
  { id: 2, headline: 'Google DeepMind Claims Breakthrough in AI Agent Autonomy', source: 'The Verge', relevanceScore: 94, category: 'agents', timestamp: new Date(Date.now() - 3600000).toISOString() },
  { id: 3, headline: 'AI Startup Raises $500M Series B With No Revenue, Only Vibes', source: 'Bloomberg', relevanceScore: 91, category: 'funding', timestamp: new Date(Date.now() - 5400000).toISOString() },
  { id: 4, headline: 'EU Proposes New AI Regulation Framework Targeting Foundation Models', source: 'Reuters', relevanceScore: 87, category: 'regulation', timestamp: new Date(Date.now() - 7200000).toISOString() },
  { id: 5, headline: 'McKinsey Report: AI Will Displace 30% of Knowledge Workers by 2028', source: 'Financial Times', relevanceScore: 85, category: 'jobs', timestamp: new Date(Date.now() - 9000000).toISOString() },
  { id: 6, headline: "Anthropic's Claude Achieves State-of-the-Art on New Reasoning Benchmarks", source: 'Ars Technica', relevanceScore: 82, category: 'default', timestamp: new Date(Date.now() - 10800000).toISOString() },
  { id: 7, headline: 'Microsoft Integrates AI Copilot Into Every Office Product', source: 'Wired', relevanceScore: 79, category: 'agents', timestamp: new Date(Date.now() - 14400000).toISOString() },
  { id: 8, headline: 'Meta Open-Sources New 400B Parameter Language Model', source: 'VentureBeat', relevanceScore: 76, category: 'default', timestamp: new Date(Date.now() - 18000000).toISOString() },
];

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getToneFromSummary(soulSummary: string | null): string {
  if (!soulSummary) return 'contrarian';
  const s = soulSummary.toLowerCase();
  if (s.includes('contrarian')) return 'contrarian';
  if (s.includes('optimist')) return 'optimist';
  if (s.includes('analyst')) return 'analyst';
  if (s.includes('provocateur')) return 'provocateur';
  if (s.includes('educator')) return 'educator';
  return 'contrarian';
}

export function getTopicKey(topic: string): TopicKey {
  const t = topic.toLowerCase();
  if (t.includes('openai') || t.includes('gpt') || t.includes('sam altman')) return 'openai';
  if (t.includes('google') || t.includes('deepmind') || t.includes('gemini')) return 'google';
  if (t.includes('regulat') || t.includes('policy') || t.includes('law') || t.includes('eu ')) return 'regulation';
  if (t.includes('fund') || t.includes('invest') || t.includes('vc') || t.includes('valuat')) return 'funding';
  if (t.includes('agent')) return 'agents';
  if (t.includes('job') || t.includes('work') || t.includes('employ')) return 'jobs';
  return 'default';
}

/**
 * Generate a tweet take in the given tone for the given topic string.
 */
export function getRandomTake(tone: string, topic: string): string {
  const toneTemplates = TEMPLATES[tone] || TEMPLATES.contrarian;
  const topicKey = getTopicKey(topic);
  const pool = toneTemplates[topicKey] || toneTemplates.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate a reply in the given tone directed at the given handle.
 */
export function getRandomReply(tone: string, authorHandle: string): string {
  const replyPool = REPLY_TEMPLATES[tone] || REPLY_TEMPLATES.contrarian;
  const fn = replyPool[Math.floor(Math.random() * replyPool.length)];
  return fn(authorHandle);
}
