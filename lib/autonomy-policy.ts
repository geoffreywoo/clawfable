import type { AutonomyMode } from './types';

// Legacy operator-authored queue items still use this threshold. V2 output has
// already passed deterministic eligibility and pairwise copy selection.
export function getAutonomyConfidenceThreshold(mode: AutonomyMode): number {
  if (mode === 'safe') return 0.7;
  if (mode === 'explore') return 0.44;
  return 0.58;
}
