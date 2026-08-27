import { getAccountTopicPolicyIssue } from './account-topic-policy';
import { isGeoffreyAccount } from './account-taste';
import { getAntiFundPortfolioPolicyIssue } from './antifund-portfolio';
import type { PortfolioCompanyGenerationContext } from './types';

export function getAccountPublishingPolicyIssue({
  handle,
  content,
  topic,
  portfolioCompanyContext,
}: {
  handle: string | null | undefined;
  content: string;
  topic?: string | null;
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null;
}): string | null {
  const accountTopicIssue = getAccountTopicPolicyIssue(
    handle,
    `${topic || ''} ${content}`,
    null,
    portfolioCompanyContext,
  );
  if (accountTopicIssue) return accountTopicIssue;
  if (!isGeoffreyAccount(handle) && !portfolioCompanyContext) return null;
  return getAntiFundPortfolioPolicyIssue(content, portfolioCompanyContext);
}
