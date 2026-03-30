'use client';

import { SetupWizard } from './setup-wizard';
import { normalizeSetupStep } from '@/lib/setup-state';
import type { AgentDetail } from '@/lib/types';

interface Props {
  agentId: string;
  agent: AgentDetail;
  onComplete: () => void;
  onClose: () => void;
}

export function SetupContinuation({ agentId, agent, onComplete, onClose }: Props) {
  const setupStep = normalizeSetupStep(agent.setupStep);
  const initialStep = setupStep === 'preview' ? 'preview' : setupStep === 'analyze' ? 'analyze' : 'soul';

  return (
    <SetupWizard
      open
      onClose={onClose}
      onCreated={onComplete}
      resumeAgentId={agentId}
      initialStep={initialStep}
    />
  );
}
