import type { VoiceProfile } from './soul-parser';
import { isGeoffreyAccount, isGeoffreyVoiceProfile } from './account-taste';

export const GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION = 'geoffrey-company-amplification-1';

export const GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES = ['Cursor'] as const;
export const GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES = ['OpenAI', 'Cognition'] as const;

const CURSOR_COMPANY_PATTERN = /(?:^|[^a-z0-9_])(?:@cursor_ai|cursor)(?=$|[^a-z0-9_])/i;

export function getGeoffreyCompanyAmplificationIssue(
  handle: string | null | undefined,
  value: string | null | undefined,
): string | null {
  if (!isGeoffreyAccount(handle) || !CURSOR_COMPANY_PATTERN.test(String(value || ''))) return null;
  return '@geoffwoo autonomous company-amplification policy suppresses Cursor. Prefer OpenAI or Cognition for generated company-conviction posts.';
}

export function getGeoffreyVoiceProfileCompanyAmplificationIssue(
  voiceProfile: VoiceProfile | null | undefined,
  value: string | null | undefined,
): string | null {
  if (!isGeoffreyVoiceProfile(voiceProfile) || !CURSOR_COMPANY_PATTERN.test(String(value || ''))) return null;
  return '@geoffwoo autonomous company-amplification policy suppresses Cursor. Prefer OpenAI or Cognition for generated company-conviction posts.';
}
