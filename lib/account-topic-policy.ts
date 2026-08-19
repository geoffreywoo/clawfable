import type { VoiceProfile } from './soul-parser';
import type { TopicSemanticDomain } from './trending';
import { isGeoffreyAccount, isGeoffreyVoiceProfile } from './account-taste';

export const ACCOUNT_TOPIC_POLICY_VERSION = 'account-topic-policy-1';

const SPORTS_TOPIC_PATTERN = /\b(?:sports?|athletes?|athletic competition|boxing|boxer|mma|ufc|pfl|nfl|nba|wnba|mlb|nhl|ncaa|football|basketball|baseball|hockey|soccer|tennis|padel|pickleball|golf|cricket|formula\s*1|f1|world cup|olympics?|all[- ]star|wembanyama|wemby|caitlin clark)\b/i;

export function isSportsTopic(
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
): boolean {
  return providedDomain === 'sports_competition' || SPORTS_TOPIC_PATTERN.test(String(value || ''));
}

export function getAccountTopicPolicyIssue(
  handle: string | null | undefined,
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
): string | null {
  if (!isGeoffreyAccount(handle) || !isSportsTopic(value, providedDomain)) return null;
  return '@geoffwoo account topic policy excludes sports and competitive-sports content.';
}

export function getVoiceProfileTopicPolicyIssue(
  voiceProfile: VoiceProfile | null | undefined,
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
): string | null {
  if (!isGeoffreyVoiceProfile(voiceProfile) || !isSportsTopic(value, providedDomain)) return null;
  return '@geoffwoo account topic policy excludes sports and competitive-sports content.';
}

export function isVoiceProfileTopicBlocked(
  voiceProfile: VoiceProfile | null | undefined,
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
): boolean {
  return Boolean(getVoiceProfileTopicPolicyIssue(voiceProfile, value, providedDomain));
}
