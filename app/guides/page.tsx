import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'Step-by-step OpenClaw guides covering setup, deployment, integrations, troubleshooting, and comparisons. Practical guides tested in production.',
  alternates: { canonical: '/guides' }
};

type Guide = {
  title: string;
  description: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  time: string;
  slug: string;
  category: string;
};

const guides: Guide[] = [
  {
    category: 'Setup',
    title: 'OpenClaw Setup Guide',
    description:
      'Install and configure OpenClaw from scratch. Covers prerequisites, environment variables, your first SOUL artifact, and a working smoke test.',
    difficulty: 'Beginner',
    time: '30 min',
    slug: 'openclaw-setup-guide'
  },
  {
    category: 'Setup',
    title: 'Configuring Your First SOUL',
    description:
      'Understand the SOUL artifact format, required fields, optional scopes, and how to wire a SOUL to an active agent session.',
    difficulty: 'Beginner',
    time: '20 min',
    slug: 'configuring-first-soul'
  },
  {
    category: 'Deployment',
    title: 'Deploying OpenClaw to a VPS',
    description:
      'Run OpenClaw on a bare Ubuntu 22.04 server. Covers systemd service setup, reverse-proxy with Caddy, and zero-downtime restarts.',
    difficulty: 'Intermediate',
    time: '45 min',
    slug: 'deploy-openclaw-vps'
  },
  {
    category: 'Deployment',
    title: 'OpenClaw on Fly.io',
    description:
      'Deploy OpenClaw to Fly.io with persistent volumes for MEMORY storage. Includes fly.toml reference and common pitfalls.',
    difficulty: 'Intermediate',
    time: '25 min',
    slug: 'deploy-openclaw-fly'
  },
  {
    category: 'Integrations',
    title: 'OpenClaw Integrations Overview',
    description:
      'Supported integration points: webhooks, REST, MCP tools, and direct SDK usage. Understand which integration pattern fits your stack.',
    difficulty: 'Intermediate',
    time: '15 min',
    slug: 'openclaw-integrations'
  },
  {
    category: 'Integrations',
    title: 'Connecting OpenClaw to Slack',
    description:
      'Wire an OpenClaw agent to a Slack workspace as a bot. Covers OAuth scopes, event subscriptions, and MEMORY-backed message threading.',
    difficulty: 'Intermediate',
    time: '40 min',
    slug: 'openclaw-slack-integration'
  },
  {
    category: 'Troubleshooting',
    title: 'Debugging MEMORY Retrieval Failures',
    description:
      'Diagnose and fix the most common MEMORY lookup failures: stale indexes, key collisions, and mis-scoped artifact references.',
    difficulty: 'Intermediate',
    time: '20 min',
    slug: 'debug-memory-retrieval'
  },
  {
    category: 'Comparisons',
    title: 'OpenClaw vs DIY Agent Stacks',
    description:
      'When does rolling your own agent plumbing make sense? An honest look at maintenance costs, flexibility trade-offs, and migration paths.',
    difficulty: 'Beginner',
    time: '10 min',
    slug: 'openclaw-vs-diy'
  }
];

const categories = ['Setup', 'Deployment', 'Integrations', 'Troubleshooting', 'Comparisons'];

export default function GuidesPage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">Documentation</p>
        <h1>Guides</h1>
        <p className="doc-subtitle">
          Step-by-step guides for every stage of working with OpenClaw — from first install through
          production deployments and third-party integrations. All guides are tested against a live
          environment before publishing.
        </p>
      </div>

      {categories.map((category) => {
        const items = guides.filter((g) => g.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="hub-section">
            <p className="hub-section-title">{category}</p>
            <div className="hub-grid">
              {items.map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/guides/${guide.slug}`}
                  className="hub-card"
                >
                  <p className="hub-card-title">{guide.title}</p>
                  <p className="hub-card-desc">{guide.description}</p>
                  <div className="hub-card-meta">
                    <span className={`hub-tag hub-tag--difficulty`}>{guide.difficulty}</span>
                    <span className="hub-tag">{guide.time}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="cta-bar">
        <p>
          New to OpenClaw? The setup guide is the right first step, regardless of your background.
        </p>
        <Link href="/start" className="cta-link">
          Start Here
        </Link>
      </div>
    </div>
  );
}
