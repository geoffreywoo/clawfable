import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Playbooks',
  description:
    'OpenClaw implementation playbooks for founders, operators, and teams. Repeatable patterns for content ops, sales automation, community, and more.',
  alternates: { canonical: '/playbooks' }
};

type Playbook = {
  category: string;
  title: string;
  description: string;
  tools: string[];
  outcome: string;
  slug: string;
};

const playbooks: Playbook[] = [
  {
    category: 'Founder Ops',
    title: 'OpenClaw for Founder Ops',
    description:
      'Delegate the steady-state work of running a company to a configured agent: meeting prep, decision logs, stakeholder updates, and weekly reviews.',
    tools: ['SOUL', 'MEMORY', 'Calendar API', 'Notion'],
    outcome: '4–6 hours/week recovered from recurring admin tasks',
    slug: 'openclaw-founder-ops'
  },
  {
    category: 'Content Ops',
    title: 'OpenClaw for Content Ops',
    description:
      'Build a content production pipeline where an agent drafts, outlines, and prepares posts from a briefs backlog — without prompting from scratch each time.',
    tools: ['SOUL', 'MEMORY', 'Airtable', 'Buffer'],
    outcome: 'Consistent 5-day publishing cadence with minimal intervention',
    slug: 'openclaw-content-ops'
  },
  {
    category: 'Content Ops',
    title: 'Repurposing Long-form to Short-form',
    description:
      'Take a long article, podcast transcript, or video script and derive newsletter snippets, social posts, and quote cards — automatically, with brand voice intact.',
    tools: ['SOUL', 'MEMORY', 'Transcript API'],
    outcome: '8–12 derivative assets from a single source piece',
    slug: 'openclaw-content-repurpose'
  },
  {
    category: 'Sales / Lead Gen',
    title: 'Outbound Research and Personalization',
    description:
      'Use an OpenClaw agent with a rich MEMORY of your ICP to research prospects, score leads, and draft personalized first-touch messages without human review per contact.',
    tools: ['SOUL', 'MEMORY', 'Apollo API', 'Gmail'],
    outcome: '3x increase in personalization coverage at the same headcount',
    slug: 'openclaw-outbound-research'
  },
  {
    category: 'Support Ops',
    title: 'First-response Support Automation',
    description:
      'Configure a support agent that reads incoming tickets, classifies urgency, drafts a response from your MEMORY of past resolutions, and escalates only what it cannot answer.',
    tools: ['SOUL', 'MEMORY', 'Intercom', 'Linear'],
    outcome: 'Sub-5-minute first response time on 60–80% of inbound tickets',
    slug: 'openclaw-support-automation'
  },
  {
    category: 'Community Ops',
    title: 'Community Monitoring and Triage',
    description:
      'Monitor Discord or Slack communities, surface unanswered questions, identify high-signal threads, and generate daily digests for community managers.',
    tools: ['SOUL', 'MEMORY', 'Discord API', 'Slack API'],
    outcome: 'Zero missed questions in active channels, daily signal digest',
    slug: 'openclaw-community-ops'
  }
];

const categories = ['Founder Ops', 'Content Ops', 'Sales / Lead Gen', 'Support Ops', 'Community Ops'];

export default function PlaybooksPage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">Use Cases</p>
        <h1>Playbooks</h1>
        <p className="doc-subtitle">
          Implementation patterns for specific business functions. Each playbook includes required
          tools, architecture notes, and the expected outcome so you can evaluate fit before
          committing engineering time.
        </p>
      </div>

      {categories.map((category) => {
        const items = playbooks.filter((p) => p.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="hub-section">
            <p className="hub-section-title">{category}</p>
            <div className="hub-grid">
              {items.map((playbook) => (
                <Link
                  key={playbook.slug}
                  href={`/playbooks/${playbook.slug}`}
                  className="hub-card"
                >
                  <p className="hub-card-title">{playbook.title}</p>
                  <p className="hub-card-desc">{playbook.description}</p>
                  <div className="hub-card-meta">
                    {playbook.tools.map((tool) => (
                      <span key={tool} className="hub-tag">
                        {tool}
                      </span>
                    ))}
                  </div>
                  <p
                    className="hub-card-desc"
                    style={{ fontSize: '0.82rem', fontStyle: 'italic', marginTop: '4px' }}
                  >
                    Outcome: {playbook.outcome}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="cta-bar">
        <p>
          Not sure which playbook applies to your situation? The Start Here page routes you to the
          right starting point.
        </p>
        <Link href="/start" className="cta-link">
          Start Here
        </Link>
      </div>
    </div>
  );
}
