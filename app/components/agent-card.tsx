'use client';

import { useRouter } from 'next/navigation';
import { SETUP_BANNER_CONTENT, normalizeSetupStep } from '@/lib/setup-state';
import type { AgentSummary } from '@/lib/types';

function getAgentHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

interface AgentCardProps {
  agent: AgentSummary;
}

export function AgentCard({ agent }: AgentCardProps) {
  const router = useRouter();
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

  const handleOpen = () => {
    router.push(`/agent/${agent.id}`);
  };

  return (
    <div
      className="agent-card"
      style={{
        borderColor: `hsla(${hue}, 60%, 40%, 0.2)`,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 0 18px hsla(${hue}, 60%, 40%, 0.12)`;
        el.style.borderColor = `hsla(${hue}, 60%, 40%, 0.45)`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '';
        el.style.borderColor = `hsla(${hue}, 60%, 40%, 0.2)`;
      }}
      onClick={handleOpen}
      data-testid={`card-agent-${agent.id}`}
    >
      {/* Header */}
      <div className="agent-card-header">
        <div className="agent-identity">
          <div
            className="agent-avatar"
            style={{
              background: `hsla(${hue}, 60%, 22%, 0.5)`,
              border: `1px solid hsla(${hue}, 60%, 40%, 0.3)`,
              color: `hsl(${hue}, 60%, 65%)`,
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
      <button
        className="btn"
        style={{
          width: '100%',
          justifyContent: 'center',
          background: `hsla(${hue}, 60%, 22%, 0.3)`,
          border: `1px solid hsla(${hue}, 60%, 40%, 0.3)`,
          color: `hsl(${hue}, 60%, 65%)`,
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleOpen();
        }}
        data-testid={`button-open-agent-${agent.id}`}
      >
        {inSetup ? 'CONTINUE SETUP' : 'OPEN CONTROL ROOM'}
      </button>
    </div>
  );
}
