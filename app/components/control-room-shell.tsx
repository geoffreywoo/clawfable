'use client';

import { HomeMissionControl } from './home-mission-control';
import type { AgentSummary, BillingSummary } from '@/lib/types';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

interface ControlRoomShellProps {
  initialUser: AuthUser;
  initialAgents: AgentSummary[];
}

export function ControlRoomShell({ initialUser, initialAgents }: ControlRoomShellProps) {
  return <HomeMissionControl initialUser={initialUser} initialAgents={initialAgents} />;
}
