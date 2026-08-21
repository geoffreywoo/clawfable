import type { VoiceProfile } from './soul-parser';
import type { TopicSemanticDomain } from './trending';
import type { PortfolioCompanyGenerationContext } from './types';
import { isGeoffreyAccount, isGeoffreyVoiceProfile } from './account-taste';
import { isQualifiedSportsPortfolioContext } from './antifund-portfolio';

export { isQualifiedSportsPortfolioContext } from './antifund-portfolio';

export const ACCOUNT_TOPIC_POLICY_VERSION = 'account-topic-policy-2';

const SPORTS_TOPIC_PATTERN = /\b(?:sports?|athletes?|athletic competition|boxing|boxer|mma|ufc|pfl|nfl|nba|wnba|mlb|nhl|ncaa|football|basketball|baseball|hockey|soccer|tennis|padel|pickleball|golf|cricket|formula\s*1|f1|world cup|olympics?|all[- ]star|wembanyama|wemby|caitlin clark)\b/i;
const SPORTS_EVENT_CONTEXT_PATTERN = /\b(?:tonight(?:'s)?\s+(?:game|match|fight)|(?:game|match|fight)\s+(?:tonight|tomorrow)|sign\s+(?:this|that|a)\s+player|trade\s+(?:this|that|a)\s+player|player\s+(?:trade|signing|ranking)|final\s+score|playoffs?|championship\s+game|fight\s+card|betting\s+odds)\b/i;

export function isSportsTopic(
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
): boolean {
  const content = String(value || '');
  return providedDomain === 'sports_competition'
    || SPORTS_TOPIC_PATTERN.test(content)
    || SPORTS_EVENT_CONTEXT_PATTERN.test(content);
}

export function getAccountTopicPolicyIssue(
  handle: string | null | undefined,
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null,
): string | null {
  if (!isGeoffreyAccount(handle) || !isSportsTopic(value, providedDomain)) return null;
  if (isQualifiedSportsPortfolioContext(value, portfolioCompanyContext)) return null;
  return '@geoffwoo account topic policy excludes sports and competitive-sports content unless it is a qualified Anti Fund portfolio-company business post.';
}

export function getVoiceProfileTopicPolicyIssue(
  voiceProfile: VoiceProfile | null | undefined,
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null,
): string | null {
  if (!isGeoffreyVoiceProfile(voiceProfile) || !isSportsTopic(value, providedDomain)) return null;
  if (isQualifiedSportsPortfolioContext(value, portfolioCompanyContext)) return null;
  return '@geoffwoo account topic policy excludes sports and competitive-sports content unless it is a qualified Anti Fund portfolio-company business post.';
}

export function isVoiceProfileTopicBlocked(
  voiceProfile: VoiceProfile | null | undefined,
  value: string | null | undefined,
  providedDomain?: TopicSemanticDomain | null,
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null,
): boolean {
  return Boolean(getVoiceProfileTopicPolicyIssue(
    voiceProfile,
    value,
    providedDomain,
    portfolioCompanyContext,
  ));
}
