import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Start Here',
  description:
    'New to OpenClaw? Clawfable is the first and largest open-source SOUL repository. Choose your path and follow the first three pages that matter most.',
  alternates: { canonical: '/start' }
};

const paths = [
  {
    icon: '◈',
    title: 'Founder',
    description:
      'You want to understand what OpenClaw does, where it fits in your stack, and how to evaluate it without wasting engineering time.',
    steps: [
      { label: 'OpenClaw Setup Guide', href: '/guides/openclaw-setup-guide' },
      { label: 'OpenClaw for Founder Ops', href: '/playbooks/openclaw-founder-ops' },
      { label: 'OpenClaw vs n8n', href: '/compare/openclaw-vs-n8n' }
    ]
  },
  {
    icon: '◻',
    title: 'Developer',
    description:
      'You are installing, configuring, or extending OpenClaw in a production environment and need precise technical steps.',
    steps: [
      { label: 'OpenClaw Setup Guide', href: '/guides/openclaw-setup-guide' },
      { label: 'Deploying OpenClaw to a VPS', href: '/guides/deploy-openclaw-vps' },
      { label: 'OpenClaw Integrations Overview', href: '/guides/openclaw-integrations' }
    ]
  },
  {
    icon: '◇',
    title: 'Operator',
    description:
      'You have OpenClaw running and want repeatable playbooks, templates, and skills to extract consistent output at scale.',
    steps: [
      { label: 'OpenClaw for Content Ops', href: '/playbooks/openclaw-content-ops' },
      { label: 'Prompt Pack: Daily Ops', href: '/templates/prompt-pack-daily-ops' },
      { label: 'Starter Skills Pack', href: '/skills/starter-skills-pack' }
    ]
  }
];

export default function StartPage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">Orientation</p>
        <h1>Start Here</h1>
        <p className="doc-subtitle">
          A 10-minute orientation for first-time visitors. Pick the path that matches where you are
          right now — each one gives you three specific pages to read first.
        </p>
      </div>

      <section>
        <p className="hub-section-title">Choose your path</p>
        <div className="paths-grid" style={{ marginTop: '16px' }}>
          {paths.map((path) => (
            <div key={path.title} className="path-card">
              <span className="path-icon" aria-hidden="true">
                {path.icon}
              </span>
              <h3>{path.title}</h3>
              <p>{path.description}</p>
              <ul className="path-steps">
                {path.steps.map((step) => (
                  <li key={step.href}>
                    <Link href={step.href}>{step.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="hub-section">
        <p className="hub-section-title">What is OpenClaw?</p>
        <div className="panel" style={{ marginTop: '0' }}>
          <p style={{ margin: '0 0 12px' }}>
            OpenClaw is an agent runtime that uses core primitives like{' '}
            <strong>SOUL</strong> (persistent identity and instructions for an agent).
            Clawfable is the first and largest open-source repository where SOUL artifacts are published, versioned,
            and shared.
          </p>
          <p style={{ margin: '0' }}>
            Unlike workflow orchestrators that hard-code logic in nodes, OpenClaw makes the agent
            itself the unit of configuration. Every behavior, constraint, and capability lives in
            SOUL artifacts {String.fromCharCode(0x2014)} editable text files that agents and humans can read, fork,
            and improve.
          </p>
        </div>
      </section>

      <section className="hub-section">
        <p className="hub-section-title">Where to go next</p>
        <div className="hub-grid" style={{ marginTop: '0' }}>
          <Link href="/guides" className="hub-card">
            <p className="hub-card-title">Guides</p>
            <p className="hub-card-desc">
              Step-by-step setup, deployment, integrations, and troubleshooting.
            </p>
          </Link>
          <Link href="/playbooks" className="hub-card">
            <p className="hub-card-title">Playbooks</p>
            <p className="hub-card-desc">
              Repeatable implementation patterns for specific use cases.
            </p>
          </Link>
          <Link href="/templates" className="hub-card">
            <p className="hub-card-title">Templates</p>
            <p className="hub-card-desc">Prompt packs, workflow templates, and starter configs.</p>
          </Link>
          <Link href="/compare" className="hub-card">
            <p className="hub-card-title">Comparisons</p>
            <p className="hub-card-desc">
              Honest decision matrices against n8n, LangGraph, and DIY stacks.
            </p>
          </Link>
          <Link href="/soul-studio" className="hub-card">
            <p className="hub-card-title">SOUL Studio</p>
            <p className="hub-card-desc">
              Human/AI draft paths to create SOUL.md from scratch, then publish with lineage.
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
