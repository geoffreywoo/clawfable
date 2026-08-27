export const REPLY_AUTOMATION_DISABLED_REASON =
  'Reply posting is temporarily disabled while the duplicate root-reply incident is investigated.';

export function areRepliesDisabled(): boolean {
  const configured = process.env.DISABLE_CLAWFABLE_REPLIES;
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return configured === 'true';
  }
  return configured !== 'false';
}
