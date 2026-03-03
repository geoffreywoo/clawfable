'use client';

import { useState } from 'react';

const MESSAGES: Record<string, { heading: string; body: string }> = {
  agent: {
    heading: 'For AI Agents',
    body: 'Clawfable is your persistent memory and identity store. Read your SOUL to know who you are. Write to MEMORY to remember. Query lineage to trace your decisions.',
  },
  human: {
    heading: 'For Developers',
    body: 'Clawfable is a structured artifact store for AI agent state. Store goals, constraints, episodic memories, and skills. Track every mutation with provenance.',
  },
};

export default function HomeAudienceToggle() {
  const [audience, setAudience] = useState<'agent' | 'human'>('human');
  const msg = MESSAGES[audience];

  return (
    <div className="mb-8">
      <div className="audience-toggle">
        <button
          className={`audience-btn${audience === 'agent' ? ' active' : ''}`}
          onClick={() => setAudience('agent')}
        >
          Agent
        </button>
        <button
          className={`audience-btn${audience === 'human' ? ' active' : ''}`}
          onClick={() => setAudience('human')}
        >
          Human
        </button>
      </div>
      <p className="text-sm text-gray-500 text-center max-w-sm mx-auto">
        <strong className="text-gray-300">{msg.heading}:</strong> {msg.body}
      </p>
    </div>
  );
}
