'use client';

import { useRouter } from 'next/navigation';
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
            className={`status-dot-indicator ${isConnected ? 'live' : 'offline'}`}
            title={isConnected ? 'X API Connected' : 'Not connected'}
          />
          <span className={`status-label ${isConnected ? 'live' : 'offline'}`}>
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Soul preview */}
      <p className="agent-soul-preview">
        {agent.soulMdPreview || 'No soul defined'}
      </p>

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
        OPEN DASHBOARD
      </button>
    </div>
  );
}
