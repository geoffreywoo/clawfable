'use client';

import Link from 'next/link';
import { SETUP_BANNER_CONTENT, normalizeSetupStep } from '@/lib/setup-state';
import type { AgentSummary } from '@/lib/types';

function getAgentHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

interface AgentCardProps {
  agent: AgentSummary;
}

export function AgentCard({ agent }: AgentCardProps) {
  const hue = getAgentHue(agent.name);
  const isConnected = agent.isConnected === 1;
  const setupStep = normalizeSetupStep(agent.setupStep);
  const inSetup = setupStep !== 'ready';
  const setupContent = inSetup ? SETUP_BANNER_CONTENT[setupStep] : null;
  const soulPreview = agent.soulMdPreview && !agent.soulMdPreview.startsWith('# Pending')
    ? agent.soulMdPreview
    : inSetup
      ? 'Setup is still in progress. Open the control room to finish the voice contract and approve the first batch.'
      : 'Open the control room to inspect the queue, tune the voice, and watch what the system is learning.';

  return (
    <Link
      href={`/agent/${agent.id}`}
      className="agent-card"
      style={{
        borderColor: `hsla(${hue}, 45%, 48%, 0.22)`,
        color: 'inherit',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 18px 40px hsla(${hue}, 30%, 42%, 0.16)`;
        el.style.borderColor = `hsla(${hue}, 45%, 48%, 0.42)`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '';
        el.style.borderColor = `hsla(${hue}, 45%, 48%, 0.22)`;
      }}
      data-testid={`card-agent-${agent.id}`}
    >
      {/* Header */}
      <div className="agent-card-header">
        <div className="agent-identity">
          <div
            className="agent-avatar"
            style={{
              background: `hsla(${hue}, 60%, 92%, 1)`,
              border: `1px solid hsla(${hue}, 45%, 48%, 0.22)`,
              color: `hsl(${hue}, 45%, 34%)`,
            }}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="agent-name">{agent.name}</div>
            <div className="agent-handle">@{agent.handle}</div>
          </div>
        </div>
        <div className="status-dot">
          <div
            className={`status-dot-indicator ${inSetup ? 'setup' : isConnected ? 'live' : 'offline'}`}
            title={inSetup ? 'Setup in progress' : isConnected ? 'X API Connected' : 'Not connected'}
          />
          <span className={`status-label ${inSetup ? 'setup' : isConnected ? 'live' : 'offline'}`}>
            {inSetup ? 'SETUP' : isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Soul preview */}
      <p className="agent-soul-preview">
        {soulPreview}
      </p>

      {setupContent && (
        <div className="agent-card-next-step">
          <p className="agent-card-next-label">NEXT STEP</p>
          <p className="agent-card-next-title">{setupContent.title}</p>
          <p className="agent-card-next-desc">{setupContent.desc}</p>
        </div>
      )}

      {/* Stats */}
      <div className="agent-stats mb-4">
        <span>
          <span className="agent-stat-value">{agent.tweetCount}</span> tweets
        </span>
        <span>
          <span className="agent-stat-value">{agent.mentionCount}</span> mentions
        </span>
      </div>

      {/* Open button */}
      <span
        className="btn"
        style={{
          width: '100%',
          justifyContent: 'center',
          background: `hsla(${hue}, 60%, 95%, 1)`,
          border: `1px solid hsla(${hue}, 45%, 48%, 0.22)`,
          color: `hsl(${hue}, 45%, 34%)`,
        }}
        data-testid={`button-open-agent-${agent.id}`}
      >
        {inSetup ? 'Continue setup' : 'Open control room'}
      </span>
    </Link>
  );
}
