import type { ContentStyleMode, Tweet } from './types';

export const STANDARD_STYLE_MODE: ContentStyleMode = 'standard';
export const SHITPOAST_STYLE_MODE: ContentStyleMode = 'shitpoast';
export const SHITPOAST_MAX_SHARE = 0.2;
export const SHITPOAST_MIN_BATCH_SIZE = 4;

export function normalizeContentStyleMode(value: unknown): ContentStyleMode {
  return value === SHITPOAST_STYLE_MODE ? SHITPOAST_STYLE_MODE : STANDARD_STYLE_MODE;
}

export function getShitpoastSlotCount(count: number, enabled: boolean | null | undefined): number {
  if (!enabled || count < SHITPOAST_MIN_BATCH_SIZE) return 0;
  return Math.max(1, Math.floor(count * SHITPOAST_MAX_SHARE));
}

export function buildShitpoastSlotSet(count: number, enabled: boolean | null | undefined): Set<number> {
  const slotCount = getShitpoastSlotCount(count, enabled);
  const slots = new Set<number>();
  if (slotCount <= 0) return slots;

  const step = count / slotCount;
  for (let index = 0; index < slotCount; index++) {
    slots.add(Math.min(count, Math.max(1, Math.ceil((index + 0.5) * step))));
  }
  return slots;
}

export function tweetStyleMode(tweet: Pick<Tweet, 'styleMode'> | null | undefined): ContentStyleMode {
  return normalizeContentStyleMode(tweet?.styleMode);
}

export function metadataWithStyleMode(
  tweet: Pick<Tweet, 'styleMode'> | null | undefined,
  metadata: Record<string, string | number | boolean | null> = {},
): Record<string, string | number | boolean | null> {
  return {
    ...metadata,
    styleMode: tweetStyleMode(tweet),
  };
}
