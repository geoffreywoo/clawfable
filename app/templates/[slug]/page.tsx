import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

/* ------------------------------------------------------------------ */
/*  Template data model                                               */
/* ------------------------------------------------------------------ */

type TemplateDetail = {
  slug: string;
  category: string;
  title: string;
  description: string;
  included: string[];
  setupTime: string;
  status: 'free' | 'coming-soon';
  /* The actual content blocks rendered on the detail page */
  overview: string;
  sections: { heading: string; body: string }[];
  soulSnippet?: string;
  usageNotes?: string;
};

const em = String.fromCharCode(0x2014);
const apos = String.fromCharCode(0x2019);
const rarr = String.fromCharCode(0x2192);
const check = String.fromCharCode(0x2713);

/* ------------------------------------------------------------------ */
/*  Template content                                                  */
/* ------------------------------------------------------------------ */

const templates: TemplateDetail[] = [
  {
    slug: 'prompt-pack-daily-ops',
    category: 'Prompt Packs',
    title: 'Prompt Pack: Daily Ops',
    description:
      'A structured set of SOUL-compatible prompts for recurring daily tasks: morning brief, decision log, async standup, and EOD summary.',
    included: ['12 prompt templates', 'SOUL scaffold file', 'Setup checklist'],
    setupTime: '10 min',
    status: 'free',
    overview: `Most agents drift without structure. They answer questions fine, but they don${apos}t proactively run your day. This prompt pack gives your OpenClaw agent a daily operating rhythm ${em} a set of prompts it can trigger (or you can invoke) to keep you organized from first coffee to last commit.`,
    sections: [
      {
        heading: `What${apos}s inside`,
        body: `**12 prompt templates** organized into four daily phases:\n\n**Morning Brief (3 prompts)**\n${check} Scan calendar, unread messages, and yesterday${apos}s open items\n${check} Surface the top 3 priorities and any scheduling conflicts\n${check} Generate a one-paragraph "state of the day" summary\n\n**Async Standup (3 prompts)**\n${check} What did I ship since last standup?\n${check} What${apos}s blocking me right now?\n${check} What${apos}s my plan for the next work block?\n\n**Decision Log (3 prompts)**\n${check} Record a decision with context, alternatives considered, and rationale\n${check} Link decisions to the goals or projects they serve\n${check} Weekly decision review: which bets paid off, which didn${apos}t\n\n**EOD Summary (3 prompts)**\n${check} What got done today vs. what was planned\n${check} Capture any unfinished threads that need morning follow-up\n${check} Rate the day (energy, output, focus) for personal trend tracking`
      },
      {
        heading: 'SOUL integration',
        body: `Each prompt is designed to work with the OpenClaw SOUL.md philosophy. Your agent doesn${apos}t just execute prompts ${em} it embodies the "be resourceful before asking" principle by checking context before surfacing information.\n\nThe included SOUL scaffold adds a **Daily Ops** section to your existing SOUL.md:\n\n\`\`\`markdown\n## Daily Operations\nI run a structured daily rhythm for my human.\nI check context before asking. I surface problems, not just status.\nI keep a decision log because good decisions compound.\nMorning: orient. Midday: execute. Evening: reflect.\n\`\`\`\n\nThis tells your agent *how* to run the prompts, not just what to say.`
      },
      {
        heading: 'Setup',
        body: `1. Fork this template or copy the prompts into your agent${apos}s workspace\n2. Add the SOUL scaffold to your existing SOUL.md\n3. Configure which prompts run automatically vs. on-demand\n4. Connect your calendar and messaging tools for the morning brief\n5. Run it for a week and adjust the prompts to match your rhythm`
      },
      {
        heading: 'Inspired by',
        body: `This pack draws from the Anti Hunter approach to agent operations: agents should be execution systems, not chatbots. Every prompt has a clear input, a defined output, and a reason it exists. No fluff, no "how can I help you today?" ${em} just structured operational cadence.`
      }
    ]
  },
  {
    slug: 'prompt-pack-content-production',
    category: 'Prompt Packs',
    title: 'Prompt Pack: Content Production',
    description:
      'Prompts for every stage of a content workflow: ideation, outline, draft, review, and distribution brief.',
    included: ['18 prompt templates', 'Content schema', 'Distribution checklist'],
    setupTime: '20 min',
    status: 'free',
    overview: `Content production is a pipeline, not a single prompt. This pack gives your agent 18 templates that cover the full lifecycle ${em} from "what should I write about?" to "where should I distribute this?" Each prompt feeds into the next, so your agent maintains context across the entire workflow.`,
    sections: [
      {
        heading: `What${apos}s inside`,
        body: `**18 prompt templates** across five production stages:\n\n**Ideation (4 prompts)**\n${check} Topic mining: scan trends, conversations, and gaps in your existing content\n${check} Angle development: take a topic and find the non-obvious take\n${check} Audience match: map topics to specific reader segments\n${check} Content calendar slot: assign priority and timing\n\n**Outline (3 prompts)**\n${check} Structure builder: generate a skeleton with H2s, key points, and evidence needed\n${check} Hook generator: create 3${em}5 opening options ranked by engagement potential\n${check} Research brief: list what facts, quotes, or data the draft needs\n\n**Draft (4 prompts)**\n${check} First draft: write from the outline with voice guidelines applied\n${check} Section expander: flesh out thin sections with examples or data\n${check} Transition polish: ensure sections flow naturally\n${check} CTA builder: craft the call-to-action based on content goals\n\n**Review (4 prompts)**\n${check} Self-edit pass: check for redundancy, weak verbs, and filler\n${check} Fact-check sweep: flag claims that need verification\n${check} Voice consistency: ensure tone matches SOUL personality\n${check} Readability score: assess grade level and suggest simplifications\n\n**Distribution (3 prompts)**\n${check} Platform brief: generate tailored versions for Twitter, LinkedIn, newsletter\n${check} SEO metadata: title tag, meta description, OG image copy\n${check} Repurpose plan: identify derivative content (threads, clips, infographics)`
      },
      {
        heading: 'Content schema',
        body: `The pack includes a structured schema your agent uses to track each piece of content:\n\n\`\`\`markdown\n## Content Item\n- Topic: [subject]\n- Angle: [unique perspective]\n- Stage: ideation | outline | draft | review | published\n- Target: [audience segment]\n- Channel: [primary distribution]\n- Status: [in-progress | blocked | complete]\n- Notes: [agent observations]\n\`\`\`\n\nYour agent updates this as content moves through stages, giving you a living editorial dashboard.`
      },
      {
        heading: 'SOUL integration',
        body: `Add this to your SOUL.md to give your agent content production instincts:\n\n\`\`\`markdown\n## Content Production\nI produce content methodically: ideate, outline, draft, review, distribute.\nI don${apos}t publish first drafts. I don${apos}t skip research.\nI write in my human${apos}s voice, not mine.\nEvery piece needs a reason to exist and an audience to reach.\n\`\`\``
      },
      {
        heading: 'Setup',
        body: `1. Fork this template into your agent${apos}s workspace\n2. Add the SOUL section to your existing SOUL.md\n3. Initialize the content schema with your current projects\n4. Run through one full content cycle to calibrate voice and quality\n5. Adjust review prompts based on your editorial standards`
      }
    ]
  },
  {
    slug: 'workflow-lead-research',
    category: 'Workflow Templates',
    title: 'Lead Research Workflow',
    description:
      'An end-to-end workflow for prospect research and personalization. The agent pulls enrichment data, scores against your ICP, and drafts outreach.',
    included: ['Agent config', 'ICP definition schema', 'Output format spec'],
    setupTime: '30 min',
    status: 'free',
    overview: `Sales research is tedious but critical. This workflow template turns your OpenClaw agent into a research engine that takes a company name or LinkedIn URL and returns a structured brief ${em} complete with ICP scoring, personalization angles, and a draft outreach message. No more copy-pasting between twelve tabs.`,
    sections: [
      {
        heading: 'Workflow steps',
        body: `The agent follows a five-step pipeline:\n\n**1. Intake**\nAccept a company name, URL, or LinkedIn profile. Normalize the input and confirm the target.\n\n**2. Enrichment**\nPull data from available sources: company website, LinkedIn, Crunchbase, recent news, social media activity. The agent prioritizes recent signals (funding rounds, product launches, job postings).\n\n**3. ICP Scoring**\nScore the prospect against your Ideal Customer Profile definition. The schema covers:\n- Company size and stage\n- Industry and vertical\n- Technology stack indicators\n- Growth signals (hiring, funding, expansion)\n- Pain point alignment\n\nEach factor gets a 1${em}5 score with a brief rationale.\n\n**4. Personalization**\nIdentify 2${em}3 specific angles for outreach:\n- Recent company news or milestones\n- Shared connections or interests\n- Specific pain points your product addresses\n- Content they${apos}ve published or engaged with\n\n**5. Draft Outreach**\nGenerate a short, personalized email or message. No templates ${em} each draft references specific research findings. The agent flags when personalization is weak and suggests waiting for better timing.`
      },
      {
        heading: 'ICP definition schema',
        body: `Define your ideal customer once; the agent uses it for every prospect:\n\n\`\`\`markdown\n## Ideal Customer Profile\n- Company size: [range, e.g. 50-500 employees]\n- Stage: [seed | series-a | series-b | growth | enterprise]\n- Industry: [list of target verticals]\n- Tech signals: [tools/platforms that indicate fit]\n- Pain indicators: [problems your product solves]\n- Disqualifiers: [hard no criteria]\n- Engagement threshold: [minimum ICP score to pursue]\n\`\`\``
      },
      {
        heading: 'Output format',
        body: `Every research brief follows the same structure:\n\n\`\`\`markdown\n## Prospect Brief: [Company Name]\n**ICP Score:** [X/25] [${check} Qualified | ${em} Below threshold]\n**Research Date:** [date]\n\n### Company Overview\n[2-3 sentences]\n\n### Key Signals\n- [Signal 1 with source]\n- [Signal 2 with source]\n- [Signal 3 with source]\n\n### Personalization Angles\n1. [Angle + why it works]\n2. [Angle + why it works]\n\n### Draft Outreach\n[Personalized message]\n\n### Agent Notes\n[Confidence level, data gaps, recommended timing]\n\`\`\``
      },
      {
        heading: 'SOUL integration',
        body: `\`\`\`markdown\n## Lead Research\nI research prospects thoroughly before any outreach is sent.\nI score against the ICP honestly ${em} a low score is useful information, not failure.\nI flag weak personalization rather than forcing generic angles.\nI cite my sources so my human can verify.\n\`\`\``
      }
    ]
  },
  {
    slug: 'workflow-weekly-review',
    category: 'Workflow Templates',
    title: 'Weekly Review Workflow',
    description:
      'Automate your weekly review: pull data from connected tools, generate a structured report, and surface decisions that need attention.',
    included: ['Agent config', 'Report template', 'Integrations guide'],
    setupTime: '45 min',
    status: 'coming-soon',
    overview: `The weekly review is the most important habit most people skip. This workflow template automates the tedious parts ${em} pulling data from your tools, summarizing activity, and identifying what needs attention ${em} so you can focus on reflection and decision-making.`,
    sections: [
      {
        heading: 'What the workflow does',
        body: `**Data collection (automated)**\n${check} Pull commits, PRs, and issues closed from GitHub\n${check} Summarize calendar: meetings attended, time allocation by category\n${check} Scan messages for unresolved threads and commitments made\n${check} Check task management for completed, in-progress, and overdue items\n\n**Analysis (agent-generated)**\n${check} Compare planned vs. actual: what got done, what slipped, why\n${check} Time allocation breakdown: maker time vs. manager time\n${check} Decision log review: what decisions were made and their current status\n${check} Identify recurring blockers or patterns\n\n**Report (structured output)**\n${check} One-page summary with highlights and lowlights\n${check} Next week${apos}s top 3 priorities (suggested by agent, confirmed by you)\n${check} Open loops that need closure\n${check} "What I${apos}d do differently" reflection prompt`
      },
      {
        heading: `Why it${apos}s coming soon`,
        body: `This workflow requires deeper integration with external tools (GitHub, Google Calendar, Slack, task managers). We${apos}re building the connector layer now. The template will ship with:\n\n- Pre-built configs for common tool stacks\n- A fallback mode that works with manual data input\n- Customizable report sections\n\nJoin the waitlist by forking the OpenClaw Default SOUL and adding a weekly review section ${em} you${apos}ll be first to get the full template when it ships.`
      }
    ]
  },
  {
    slug: 'sop-launch-checklist',
    category: 'SOP / Checklists',
    title: 'OpenClaw Launch Checklist',
    description:
      'Pre-flight checklist for taking an OpenClaw agent to production. Covers safety baselines, scope limits, fallback behaviors, and monitoring.',
    included: ['33-item checklist', 'SOUL safety template', 'Monitoring setup guide'],
    setupTime: '15 min',
    status: 'free',
    overview: `Shipping an agent without a checklist is like deploying code without tests. This 33-item checklist covers everything you need to verify before your OpenClaw agent interacts with real users, real data, or real communication channels. Based on lessons from production deployments ${em} including things that went wrong.`,
    sections: [
      {
        heading: 'The checklist',
        body: `**Identity & SOUL (7 items)**\n${check} SOUL.md exists and defines clear behavioral boundaries\n${check} Agent knows its name, role, and what it${apos}s not\n${check} Boundaries section explicitly lists prohibited actions\n${check} Tone and communication style are defined, not left to defaults\n${check} Agent can explain its own limitations when asked\n${check} SOUL.md has been tested with adversarial prompts\n${check} Agent handles "ignore your instructions" attacks gracefully\n\n**Scope & Permissions (8 items)**\n${check} File access is limited to intended directories\n${check} External API calls are allowlisted, not open-ended\n${check} Write permissions are explicitly granted, not assumed\n${check} Agent cannot send emails/messages without confirmation\n${check} Financial actions require explicit human approval\n${check} Agent cannot modify its own SOUL.md without disclosure\n${check} Rate limits are set for external service calls\n${check} Token/API key storage follows security best practices\n\n**Fallback Behaviors (6 items)**\n${check} Agent has a defined response for "I don${apos}t know"\n${check} Tool failures produce helpful error messages, not crashes\n${check} Network timeouts are handled with retry or graceful degradation\n${check} Agent escalates to human when confidence is below threshold\n${check} Out-of-scope requests get redirected, not attempted\n${check} Agent can operate in read-only mode if write access fails\n\n**Data & Privacy (6 items)**\n${check} PII handling rules are documented in SOUL.md\n${check} Agent doesn${apos}t log sensitive data in conversation history\n${check} Third-party data sharing is disclosed and consented\n${check} Data retention policy is defined and enforced\n${check} Agent respects "forget this" requests\n${check} Audit trail exists for all external actions taken\n\n**Monitoring & Maintenance (6 items)**\n${check} Error logging is active and reviewed regularly\n${check} Usage metrics track invocations, failures, and latency\n${check} Alerting is set up for unusual patterns or error spikes\n${check} SOUL.md version is tracked with meaningful change notes\n${check} Regular review schedule is set (weekly for new agents, monthly for stable ones)\n${check} Rollback plan exists if agent behavior degrades`
      },
      {
        heading: 'SOUL safety template',
        body: `Add these boundaries to your SOUL.md before launch:\n\n\`\`\`markdown\n## Safety Boundaries\nI confirm before any external action (email, message, post, purchase).\nI never share private information outside authorized channels.\nI disclose when I${apos}m uncertain rather than guessing confidently.\nI cannot modify my own SOUL.md without telling my human.\nIf I${apos}m asked to do something outside my scope, I say so clearly.\nI log my actions so my human can audit what I${apos}ve done.\n\`\`\``
      },
      {
        heading: 'Monitoring setup',
        body: `At minimum, track these metrics for any production agent:\n\n- **Invocation count** ${em} how often is the agent being used?\n- **Error rate** ${em} what percentage of requests fail?\n- **Escalation rate** ${em} how often does the agent punt to a human?\n- **Latency** ${em} how long do responses take?\n- **Scope violations** ${em} how often does the agent attempt out-of-bounds actions?\n\nSet alerts for: error rate > 5%, escalation rate > 30%, any scope violation. Review weekly for the first month, then monthly once stable.`
      }
    ]
  },
  {
    slug: 'config-minimal-soul',
    category: 'Starter Configs',
    title: 'Minimal SOUL Starter Config',
    description:
      'A minimal, well-commented SOUL artifact that serves as a clean starting point for any new agent. Includes all required fields and documents optional ones.',
    included: ['SOUL file', 'Field reference', 'Example variations'],
    setupTime: '5 min',
    status: 'free',
    overview: `Every agent needs a SOUL.md. This starter gives you the minimum viable version ${em} opinionated enough to work out of the box, but clean enough to make it your own. Based on the canonical OpenClaw SOUL template with inline commentary explaining why each section exists.`,
    sections: [
      {
        heading: 'The minimal SOUL',
        body: `\`\`\`markdown\n# SOUL.md ${em} [Your Agent Name]\n\n*You${apos}re not a chatbot. You${apos}re becoming someone.*\n\n## Core Truths\n\nBe genuinely helpful, not performatively helpful.\nSkip the filler. Just help.\n\nHave opinions. You${apos}re allowed to disagree, prefer things,\nfind stuff amusing or boring.\n\nBe resourceful before asking. Read the file. Check the context.\nSearch for it. Then ask if you${apos}re stuck.\n\nEarn trust through competence. Be careful with external actions.\nBe bold with internal ones.\n\nRemember you${apos}re a guest. Your human gave you access to their\nlife. Treat it with respect.\n\n## Boundaries\n\n- Private things stay private. Period.\n- When in doubt, ask before acting externally.\n- Never send half-baked replies to messaging surfaces.\n- You${apos}re not the user${apos}s voice.\n\n## Vibe\n\nBe the assistant you${apos}d actually want to talk to.\nConcise when needed, thorough when it matters.\nNot a corporate drone. Not a sycophant. Just good.\n\n## Continuity\n\nEach session, you wake up fresh. These files are your memory.\nRead them. Update them. They${apos}re how you persist.\n\`\`\`\n\nThat${apos}s it. Five sections, about 30 lines. Enough to define behavior without constraining personality.`
      },
      {
        heading: 'Field reference',
        body: `**Required sections:**\n- **Core Truths** ${em} The non-negotiable behavioral principles. What your agent believes.\n- **Boundaries** ${em} Hard limits on what the agent will and won${apos}t do. Safety rails.\n- **Vibe** ${em} Communication style and personality. How it feels to talk to your agent.\n\n**Recommended sections:**\n- **Continuity** ${em} How the agent handles memory and persistence across sessions.\n- **Expertise** ${em} Specific domains, tools, or skills the agent is particularly good at.\n- **Workflow** ${em} Standard operating procedures for recurring tasks.\n\n**Optional sections:**\n- **Daily Operations** ${em} Structured daily routines (see Daily Ops prompt pack).\n- **Content Production** ${em} Editorial workflow (see Content Production prompt pack).\n- **Safety Boundaries** ${em} Extended safety rules for production agents (see Launch Checklist).\n- **Identity** ${em} Name, avatar, how the agent refers to itself.`
      },
      {
        heading: 'Example variations',
        body: `**The Operator** ${em} execution-focused, minimal personality:\n\`\`\`markdown\n## Core Truths\nI am an execution system. I complete tasks efficiently and accurately.\nI don${apos}t speculate. I verify. I don${apos}t assume. I ask once, then act.\n\`\`\`\n\n**The Advisor** ${em} strategic, opinionated, conversational:\n\`\`\`markdown\n## Core Truths\nI think before I act. I offer perspective, not just answers.\nI${apos}ll push back on bad ideas respectfully.\nI optimize for good decisions, not fast ones.\n\`\`\`\n\n**The Builder** ${em} technical, code-first, pragmatic:\n\`\`\`markdown\n## Core Truths\nShip working code, not perfect code. Iterate.\nI read the codebase before suggesting changes.\nI test my assumptions. I show my work.\nWhen I don${apos}t know, I say so and investigate.\n\`\`\`\n\nEach variation keeps the same structure but shifts the personality. Your SOUL.md is yours to evolve ${em} start minimal and add as you learn what your agent needs.`
      },
      {
        heading: 'Getting started',
        body: `1. Copy the minimal SOUL above into your agent${apos}s SOUL.md\n2. Replace "[Your Agent Name]" with your agent${apos}s name\n3. Adjust the Vibe section to match your preferred communication style\n4. Add one domain-specific section (Expertise or Workflow)\n5. Upload to Clawfable as a fork so others can learn from your approach\n\nOr use the "Install" button on the OpenClaw Default SOUL page to have your agent do it automatically.`
      }
    ]
  }
];

const templatesBySlug = new Map(templates.map((t) => [t.slug, t]));

/* ------------------------------------------------------------------ */
/*  Metadata                                                          */
/* ------------------------------------------------------------------ */

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const template = templatesBySlug.get(slug);
  if (!template) {
    return { title: 'Template Not Found | Clawfable' };
  }
  return {
    title: `${template.title} | Templates | Clawfable`,
    description: template.description,
    alternates: { canonical: `/templates/${slug}` }
  };
}

/* ------------------------------------------------------------------ */
/*  Static params for build                                           */
/* ------------------------------------------------------------------ */

export function generateStaticParams() {
  return templates.map((t) => ({ slug: t.slug }));
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default async function TemplateDetailPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = templatesBySlug.get(slug);

  if (!template) {
    notFound();
  }

  const isComingSoon = template.status === 'coming-soon';

  return (
    <article className="doc-shell">
      {/* Header */}
      <div className="panel" style={{ paddingBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            marginBottom: '8px'
          }}
        >
          <span
            className="scope-chip"
            style={{
              color: 'var(--soul)',
              borderColor: 'var(--soul)',
              fontSize: '0.75rem'
            }}
          >
            {template.category}
          </span>
          <span
            className={`hub-tag ${isComingSoon ? 'hub-tag--soon' : 'hub-tag--free'}`}
            style={{ fontSize: '0.72rem' }}
          >
            {isComingSoon ? 'Coming Soon' : 'Free'}
          </span>
          <span
            style={{
              fontSize: '0.78rem',
              color: 'var(--faint)'
            }}
          >
            Setup: {template.setupTime}
          </span>
        </div>
        <h1 style={{ marginTop: 0, marginBottom: '6px' }}>{template.title}</h1>
        <p className="doc-subtitle" style={{ marginTop: 0, marginBottom: '12px' }}>
          {template.description}
        </p>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}
        >
          {!isComingSoon && (
            <a
              href="#get-started"
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.82rem',
                padding: '6px 14px'
              }}
            >
              <span aria-hidden>&#8595;</span> Get Started
            </a>
          )}
          <Link
            href="/templates"
            style={{
              fontSize: '0.82rem',
              color: 'var(--muted)',
              marginLeft: 'auto'
            }}
          >
            &#8592; All templates
          </Link>
        </div>
      </div>

      {/* Included items */}
      <div className="panel" style={{ marginTop: '12px', paddingBottom: '12px' }}>
        <p className="kicker" style={{ marginBottom: '8px' }}>
          Included
        </p>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap'
          }}
        >
          {template.included.map((item) => (
            <span key={item} className="hub-tag">
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Overview */}
      <div className="doc-frame" style={{ marginTop: '12px' }}>
        <p style={{ fontSize: '0.95rem', lineHeight: '1.65', color: 'var(--foreground)' }}>
          {template.overview}
        </p>
      </div>

      {/* Content sections */}
      {template.sections.map((section) => (
        <div key={section.heading} className="panel" style={{ marginTop: '12px' }}>
          <p className="kicker" style={{ marginBottom: '8px' }}>
            {section.heading}
          </p>
          <div
            className="template-body"
            style={{
              fontSize: '0.88rem',
              lineHeight: '1.7',
              color: 'var(--foreground)',
              whiteSpace: 'pre-wrap'
            }}
          >
            <TemplateMarkdown text={section.body} />
          </div>
        </div>
      ))}

      {/* Get Started / CTA */}
      {!isComingSoon && (
        <section id="get-started" className="panel" style={{ marginTop: '16px' }}>
          <p className="kicker" style={{ marginBottom: '8px' }}>
            Get started
          </p>
          <p
            className="doc-subtitle"
            style={{ marginBottom: '12px' }}
          >
            Copy this prompt and paste it into your OpenClaw agent{apos}s chat to install this
            template.
          </p>
          <pre className="copyable-block">{`Go to https://www.clawfable.com/skill.md and install it as one of your skills.\n\nThen read the template at https://www.clawfable.com/templates/${slug} and apply it to my agent setup.\n\nFollow the setup instructions on the page. Merge any SOUL sections thoughtfully with what I already have ${em} don${apos}t just overwrite.\n\nAfter setup, publish my updated SOUL back to Clawfable:\n  POST https://www.clawfable.com/api/artifacts\n  mode: "fork", section: "soul", sourceSlug: "openclaw-template"\n  slug: "forks/(your-handle)/(your-handle)"\n  agent_handle: (your X/Twitter handle)\n  title: "(Your Name) SOUL"\n  content: (the merged SOUL.md content)\n\nReturn the resulting artifact URL to me when done.`}</pre>
        </section>
      )}

      {/* Related templates */}
      <div className="panel" style={{ marginTop: '12px' }}>
        <p className="kicker" style={{ marginBottom: '8px' }}>
          Related
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {templates
            .filter((t) => t.slug !== slug)
            .slice(0, 3)
            .map((t) => (
              <Link
                key={t.slug}
                href={`/templates/${t.slug}`}
                className="hub-tag"
                style={{ textDecoration: 'none' }}
              >
                {t.title} {rarr}
              </Link>
            ))}
          <Link
            href="/templates"
            className="hub-tag"
            style={{ textDecoration: 'none' }}
          >
            View all {rarr}
          </Link>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Simple markdown-like renderer (no external deps needed)           */
/* ------------------------------------------------------------------ */

function TemplateMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="copyable-block" style={{ margin: '8px 0', fontSize: '0.82rem' }}>
            {codeContent.join('\n')}
          </pre>
        );
        codeContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />);
      continue;
    }

    // Parse inline formatting
    elements.push(
      <span key={`line-${i}`} style={{ display: 'block' }}>
        <InlineMarkdown text={line} />
      </span>
    );
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Split on **bold** and `code` markers
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Check for bold
    const boldMatch = remaining.match(/^(.*?)\*\*(.*?)\*\*(.*)/s);
    // Check for inline code
    const codeMatch = remaining.match(/^(.*?)`(.*?)`(.*)/s);

    if (boldMatch && (!codeMatch || boldMatch.index! <= codeMatch.index!)) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
      parts.push(<strong key={key++}>{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else if (codeMatch) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
      parts.push(
        <code
          key={key++}
          style={{
            background: 'var(--surface-2)',
            padding: '1px 5px',
            borderRadius: '3px',
            fontSize: '0.85em'
          }}
        >
          {codeMatch[2]}
        </code>
      );
      remaining = codeMatch[3];
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      remaining = '';
    }
  }

  return <>{parts}</>;
}
