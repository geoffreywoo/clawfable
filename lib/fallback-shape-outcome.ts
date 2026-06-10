import type { FallbackShapeOutcomeCounter, PersonalizationMemory, TweetHookType, TweetSpecificityType, TweetStructureType } from './types';
import type { OperatorAnchorFallbackKind } from './operator-anchor-fallback';

export interface GenericFallbackShapeOutcomeInput {
  memory: PersonalizationMemory | null | undefined;
  fallbackKind: OperatorAnchorFallbackKind;
  topic: string | null | undefined;
  hook: TweetHookType | string | null | undefined;
  structure: TweetStructureType | string | null | undefined;
  specificity: TweetSpecificityType | string | null | undefined;
}

export interface GenericFallbackShapeOutcomeGuidance {
  score: number;
  counter: FallbackShapeOutcomeCounter | null;
  note: string | null;
}

function normalizeTopic(value: string | null | undefined): string {
  return String(value || 'general').trim().toLowerCase().replace(/[_-]+/g, ' ');
}

function normalizeShapeToken(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function scoreGenericFallbackShapeOutcome({
  memory,
  fallbackKind,
  topic,
  hook,
  structure,
  specificity,
}: GenericFallbackShapeOutcomeInput): GenericFallbackShapeOutcomeGuidance {
  const normalizedTopic = normalizeTopic(topic);
  const normalizedHook = normalizeShapeToken(hook);
  const normalizedStructure = normalizeShapeToken(structure);
  const normalizedSpecificity = normalizeShapeToken(specificity);

  const counter = (memory?.fallbackShapeOutcomes || [])
    .filter((item) =>
      item.fallbackKind === fallbackKind
      && (!item.topic || normalizeTopic(item.topic) === normalizedTopic)
      && normalizeShapeToken(item.hook) === normalizedHook
      && normalizeShapeToken(item.structure) === normalizedStructure
      && normalizeShapeToken(item.specificity) === normalizedSpecificity
    )
    .sort((a, b) =>
      Number(Boolean(b.topic)) - Number(Boolean(a.topic))
      || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )[0] || null;

  if (!counter) return { score: 0, counter: null, note: null };

  const score = counter.netScore >= 0
    ? Math.min(0.16, 0.035 + (counter.netScore * 0.14))
    : Math.max(-0.2, -0.045 + (counter.netScore * 0.14));
  const successCount = counter.approved + counter.posted;
  const direction = counter.netScore >= 0
    ? 'approval/posting'
    : counter.rejected > counter.edited
      ? 'rejection'
      : 'operator edits';
  const latest = counter.latestOutcome
    ? `; latest ${counter.latestOutcome} ${String(counter.latestOutcomeAt || counter.updatedAt).slice(0, 10)}`
    : '';

  return {
    score: Number(score.toFixed(3)),
    counter,
    note: `Fallback shape outcome: ${counter.total} structured signals matched this deterministic fallback shape (${successCount} approval/posting, ${counter.edited} edit, ${counter.rejected} rejection; net ${direction}${latest}).`,
  };
}
