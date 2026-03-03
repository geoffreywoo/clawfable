import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Compare',
  description:
    'OpenClaw compared to n8n, LangGraph, and DIY agent stacks. Honest decision matrices, best-for scenarios, and migration paths.',
  alternates: { canonical: '/compare' }
};

type Comparison = {
  title: string;
  tagline: string;
  slug: string;
  matrix: Array<{ dimension: string; openclaw: string; other: string }>;
  bestFor: { openclaw: string[]; other: string[] };
  otherName: string;
};

const comparisons: Comparison[] = [
  {
    title: 'OpenClaw vs n8n',
    tagline:
      'n8n is a visual workflow automation tool. OpenClaw is an agent runtime. They solve adjacent but distinct problems.',
    slug: 'openclaw-vs-n8n',
    otherName: 'n8n',
    matrix: [
      {
        dimension: 'Primary abstraction',
        openclaw: 'Agent identity (SOUL + MEMORY)',
        other: 'Workflow nodes and triggers'
      },
      {
        dimension: 'Agent persistence',
        openclaw: 'First-class — every agent has persistent MEMORY',
        other: 'Requires manual workaround with external KV store'
      },
      {
        dimension: 'Non-technical accessibility',
        openclaw: 'Text-based SOUL files — readable by anyone',
        other: 'Visual builder — accessible but proprietary'
      },
      {
        dimension: 'Orchestration complexity',
        openclaw: 'Minimal — agents act on instructions',
        other: 'High — complex flows built as node graphs'
      },
      {
        dimension: 'Self-hosting',
        openclaw: 'Open-source, lightweight, runs on a $6/mo VPS',
        other: 'Open-source, heavier, requires more resources'
      }
    ],
    bestFor: {
      openclaw: [
        'Persistent agents that need memory across sessions',
        'Teams who want agents configurable via text, not GUIs',
        'Setups where agent identity matters (branded agents, contributor agents)'
      ],
      other: [
        'Complex multi-step workflows with many third-party triggers',
        'Teams that prefer visual programming',
        'Integration-heavy automation without persistent state'
      ]
    }
  },
  {
    title: 'OpenClaw vs LangGraph',
    tagline:
      'LangGraph is a graph-based framework for building stateful LLM applications. OpenClaw is an opinionated runtime with pre-defined primitives for agent identity.',
    slug: 'openclaw-vs-langgraph',
    otherName: 'LangGraph',
    matrix: [
      {
        dimension: 'Primary abstraction',
        openclaw: 'SOUL and MEMORY artifacts (structured text)',
        other: 'State machine with typed nodes and edges'
      },
      {
        dimension: 'Setup complexity',
        openclaw: 'Low — YAML config, no graph design required',
        other: 'Medium to high — requires graph modeling upfront'
      },
      {
        dimension: 'Flexibility',
        openclaw: 'Moderate — follows the SOUL/MEMORY contract',
        other: 'High — build any topology you can reason about'
      },
      {
        dimension: 'Language requirement',
        openclaw: 'No coding required for basic agents',
        other: 'Python or JavaScript required'
      },
      {
        dimension: 'Production primitives',
        openclaw: 'Included — contributor registry, artifact versioning',
        other: 'DIY — you build the persistence and versioning'
      }
    ],
    bestFor: {
      openclaw: [
        'Operators who want to ship agents without deep LLM framework knowledge',
        'Teams that want forkable, version-controlled agent configs',
        'Use cases where agent identity and consistency matter more than graph flexibility'
      ],
      other: [
        'Research and experimental agent architectures',
        'Workflows with complex conditional branching',
        'Teams with strong Python expertise who want full control'
      ]
    }
  },
  {
    title: 'OpenClaw vs DIY Agent Stack',
    tagline:
      'Building your own agent plumbing gives you maximum control. It also means maintaining that plumbing forever.',
    slug: 'openclaw-vs-diy',
    otherName: 'DIY Stack',
    matrix: [
      {
        dimension: 'Time to first agent',
        openclaw: '< 1 hour with the setup guide',
        other: '1–3 days of scaffolding before business logic'
      },
      {
        dimension: 'Ongoing maintenance',
        openclaw: 'Maintained by the OpenClaw community',
        other: 'Owned entirely by your team'
      },
      {
        dimension: 'Agent sharing / reuse',
        openclaw: 'First-class — SOUL and MEMORY are portable',
        other: 'Manual — requires your own serialization format'
      },
      {
        dimension: 'Observability',
        openclaw: 'Structured artifact history and contributor logs',
        other: 'Whatever you build'
      },
      {
        dimension: 'Escape hatch',
        openclaw: 'SOUL and MEMORY are plain text — easy to migrate',
        other: 'You own the stack — full control'
      }
    ],
    bestFor: {
      openclaw: [
        'Teams that want to move fast and iterate on agent behavior',
        'Solo operators who cannot maintain custom infrastructure',
        'Use cases that benefit from the Clawfable community and artifact sharing'
      ],
      other: [
        'Use cases with hard constraints that OpenClaw cannot accommodate',
        'Teams with dedicated ML infrastructure engineers',
        'Proprietary agent designs that cannot be open-sourced'
      ]
    }
  }
];

export default function ComparePage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">Decision Support</p>
        <h1>Comparisons</h1>
        <p className="doc-subtitle">
          Honest evaluations of OpenClaw against common alternatives. No benchmark theater — each
          comparison focuses on the specific trade-offs that determine fit for your use case.
        </p>
      </div>

      <div className="comparison-grid">
        {comparisons.map((comp) => (
          <div key={comp.slug} className="compare-card">
            <div className="compare-card-header">
              <h3>{comp.title}</h3>
              <p>{comp.tagline}</p>
            </div>
            <div className="compare-card-body">
              <div style={{ overflowX: 'auto' }}>
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Dimension</th>
                      <th style={{ width: '36%' }}>OpenClaw</th>
                      <th style={{ width: '36%' }}>{comp.otherName}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comp.matrix.map((row) => (
                      <tr key={row.dimension}>
                        <td>
                          <strong>{row.dimension}</strong>
                        </td>
                        <td>{row.openclaw}</td>
                        <td>{row.other}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '16px',
                  marginTop: '20px'
                }}
              >
                <div>
                  <p
                    style={{
                      margin: '0 0 8px',
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--muted)'
                    }}
                  >
                    Best for: OpenClaw
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      padding: '0 0 0 1rem',
                      fontSize: '0.88rem',
                      color: 'var(--muted)',
                      lineHeight: '1.5'
                    }}
                  >
                    {comp.bestFor.openclaw.map((item) => (
                      <li key={item} style={{ marginBottom: '4px' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p
                    style={{
                      margin: '0 0 8px',
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--muted)'
                    }}
                  >
                    Best for: {comp.otherName}
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      padding: '0 0 0 1rem',
                      fontSize: '0.88rem',
                      color: 'var(--muted)',
                      lineHeight: '1.5'
                    }}
                  >
                    {comp.bestFor.other.map((item) => (
                      <li key={item} style={{ marginBottom: '4px' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div style={{ marginTop: '16px' }}>
                <Link
                  href={`/compare/${comp.slug}`}
                  style={{ fontSize: '0.9rem', color: 'var(--muted)' }}
                >
                  Full comparison with migration path &rarr;
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="cta-bar">
        <p>
          Still unsure which path is right for you? The Start Here page gives you a structured
          orientation by role.
        </p>
        <Link href="/start" className="cta-link">
          Start Here
        </Link>
      </div>
    </div>
  );
}
