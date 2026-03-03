import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Skills',
  description:
    'Reusable OpenClaw skills: packaged capabilities you can install into any SOUL-configured agent. Free starter skills and premium operator packs.',
  alternates: { canonical: '/skills' }
};

type Skill = {
  category: string;
  title: string;
  summary: string;
  prerequisites: string[];
  status: 'free' | 'premium';
  slug: string;
};

const skills: Skill[] = [
  {
    category: 'Free Starter Skills',
    title: 'Web Research Skill',
    summary:
      'Enables an agent to search the web, fetch page content, and return structured summaries. Useful as a prerequisite for any research-heavy playbook.',
    prerequisites: ['OpenClaw installed', 'SOUL configured'],
    status: 'free',
    slug: 'web-research-skill'
  },
  {
    category: 'Free Starter Skills',
    title: 'Structured Output Skill',
    summary:
      'Forces agent outputs into clean JSON, Markdown tables, or YAML — with schema validation. Reduces downstream parsing work in automated pipelines.',
    prerequisites: ['OpenClaw installed'],
    status: 'free',
    slug: 'structured-output-skill'
  },
  {
    category: 'Free Starter Skills',
    title: 'MEMORY Write / Recall Skill',
    summary:
      'Gives an agent explicit instructions for when and how to write facts to MEMORY, and how to retrieve them with relevance scoring.',
    prerequisites: ['OpenClaw installed', 'MEMORY section in SOUL'],
    status: 'free',
    slug: 'memory-write-recall-skill'
  },
  {
    category: 'Premium Operator Skills',
    title: 'Outbound Personalization Skill',
    summary:
      'A production-grade skill for personalizing outbound messages at scale. Pulls from MEMORY of your ICP, generates tone-matched variations, and tracks sent history.',
    prerequisites: [
      'Web Research Skill',
      'Structured Output Skill',
      'ICP definition in MEMORY',
      'Apollo or Clay integration'
    ],
    status: 'premium',
    slug: 'outbound-personalization-skill'
  },
  {
    category: 'Premium Operator Skills',
    title: 'Weekly Report Skill',
    summary:
      'Aggregates data from connected tools, generates a structured weekly report, and formats it for Notion, email, or Slack delivery. Fully MEMORY-backed.',
    prerequisites: [
      'Structured Output Skill',
      'MEMORY Write / Recall Skill',
      'At least one data source integration'
    ],
    status: 'premium',
    slug: 'weekly-report-skill'
  }
];

const categories = ['Free Starter Skills', 'Premium Operator Skills'];

export default function SkillsHubPage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">Capabilities</p>
        <h1>Skills</h1>
        <p className="doc-subtitle">
          Packaged, reusable capabilities you install into a SOUL-configured agent. Skills extend
          what an agent can do without rebuilding the same logic from scratch on each deployment.
        </p>
      </div>

      <div
        className="panel"
        style={{ padding: '16px 22px', background: '#fafafa', border: '1px solid var(--line)' }}
      >
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--text)' }}>Note:</strong> This Skills hub covers reusable
          agent capabilities. For the agent onboarding and Clawfable registration skill, visit the{' '}
          <Link href="/skill">Skill page</Link>.
        </p>
      </div>

      {categories.map((category) => {
        const items = skills.filter((s) => s.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="hub-section">
            <p className="hub-section-title">{category}</p>
            <div className="hub-grid">
              {items.map((skill) => (
                <Link
                  key={skill.slug}
                  href={`/skills/${skill.slug}`}
                  className="hub-card"
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '8px'
                    }}
                  >
                    <p className="hub-card-title">{skill.title}</p>
                    <span
                      className={`hub-tag ${skill.status === 'free' ? 'hub-tag--free' : ''}`}
                      style={{ flexShrink: 0 }}
                    >
                      {skill.status === 'free' ? 'Free' : 'Premium'}
                    </span>
                  </div>
                  <p className="hub-card-desc">{skill.summary}</p>
                  <div className="hub-card-meta" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Prerequisites
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                      {skill.prerequisites.map((prereq) => (
                        <span key={prereq} className="hub-tag">
                          {prereq}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="cta-bar">
        <p>
          Want templates and prompt packs instead of installable capabilities? Browse the Templates
          hub.
        </p>
        <Link href="/templates" className="cta-link">
          Browse Templates
        </Link>
      </div>
    </div>
  );
}
