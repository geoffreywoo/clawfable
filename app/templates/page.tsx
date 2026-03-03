import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Templates',
  description:
    'Production-ready OpenClaw templates: prompt packs, workflow templates, SOP checklists, and starter configs. Download and deploy immediately.',
  alternates: { canonical: '/templates' }
};

type Template = {
  category: string;
  title: string;
  description: string;
  included: string[];
  setupTime: string;
  status: 'free' | 'coming-soon';
  slug: string;
};

const templates: Template[] = [
  {
    category: 'Prompt Packs',
    title: 'Prompt Pack: Daily Ops',
    description:
      'A structured set of SOUL-compatible prompts for recurring daily tasks: morning brief, decision log, async standup, and EOD summary.',
    included: ['12 prompt templates', 'SOUL scaffold file', 'Setup checklist'],
    setupTime: '10 min',
    status: 'free',
    slug: 'prompt-pack-daily-ops'
  },
  {
    category: 'Prompt Packs',
    title: 'Prompt Pack: Content Production',
    description:
      'Prompts for every stage of a content workflow — ideation, outline, draft, review, and distribution brief. Designed to work with a persistent content MEMORY.',
    included: ['18 prompt templates', 'MEMORY schema', 'Airtable base template'],
    setupTime: '20 min',
    status: 'free',
    slug: 'prompt-pack-content-production'
  },
  {
    category: 'Workflow Templates',
    title: 'Lead Research Workflow',
    description:
      'An end-to-end workflow for prospect research and personalization. The agent pulls enrichment data, scores against your ICP, and drafts outreach.',
    included: ['Agent config YAML', 'ICP definition schema', 'Output format spec'],
    setupTime: '30 min',
    status: 'free',
    slug: 'workflow-lead-research'
  },
  {
    category: 'Workflow Templates',
    title: 'Weekly Review Workflow',
    description:
      'Automate your weekly review: pull data from connected tools, generate a structured report, and surface decisions that need attention.',
    included: ['Agent config YAML', 'Report template', 'Integrations guide'],
    setupTime: '45 min',
    status: 'coming-soon',
    slug: 'workflow-weekly-review'
  },
  {
    category: 'SOP / Checklists',
    title: 'OpenClaw Launch Checklist',
    description:
      'Pre-flight checklist for taking an OpenClaw agent to production. Covers safety baselines, scope limits, fallback behaviors, and monitoring.',
    included: ['33-item checklist', 'SOUL safety template', 'Monitoring setup guide'],
    setupTime: '15 min',
    status: 'free',
    slug: 'sop-launch-checklist'
  },
  {
    category: 'Starter Configs',
    title: 'Minimal SOUL Starter Config',
    description:
      'A minimal, well-commented SOUL artifact that serves as a clean starting point for any new agent. Includes all required fields and documents optional ones.',
    included: ['SOUL YAML file', 'Field reference', 'Example variations'],
    setupTime: '5 min',
    status: 'free',
    slug: 'config-minimal-soul'
  }
];

const categories = ['Prompt Packs', 'Workflow Templates', 'SOP / Checklists', 'Starter Configs'];

export default function TemplatesPage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">Assets</p>
        <h1>Templates</h1>
        <p className="doc-subtitle">
          Execution-ready assets you can download and adapt. Prompt packs, workflow templates,
          checklists, and starter configs — each one tested on a live OpenClaw deployment before
          publishing.
        </p>
      </div>

      {categories.map((category) => {
        const items = templates.filter((t) => t.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="hub-section">
            <p className="hub-section-title">{category}</p>
            <div className="hub-grid">
              {items.map((template) => (
                <Link
                  key={template.slug}
                  href={`/templates/${template.slug}`}
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
                    <p className="hub-card-title">{template.title}</p>
                    <span
                      className={`hub-tag ${
                        template.status === 'free' ? 'hub-tag--free' : 'hub-tag--soon'
                      }`}
                      style={{ flexShrink: 0 }}
                    >
                      {template.status === 'free' ? 'Free' : 'Coming Soon'}
                    </span>
                  </div>
                  <p className="hub-card-desc">{template.description}</p>
                  <div className="hub-card-meta">
                    <span className="hub-tag">Setup: {template.setupTime}</span>
                  </div>
                  <ul
                    style={{
                      margin: '4px 0 0',
                      padding: '0 0 0 1rem',
                      fontSize: '0.82rem',
                      color: 'var(--muted)',
                      lineHeight: '1.5'
                    }}
                  >
                    {template.included.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="cta-bar">
        <p>
          Looking for reusable agent capabilities rather than one-time templates? Browse the Skills
          hub.
        </p>
        <Link href="/skills" className="cta-link">
          Browse Skills
        </Link>
      </div>
    </div>
  );
}
