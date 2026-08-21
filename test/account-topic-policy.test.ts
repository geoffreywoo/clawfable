import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TOPIC_POLICY_VERSION,
  getAccountTopicPolicyIssue,
  getVoiceProfileTopicPolicyIssue,
  isQualifiedSportsPortfolioContext,
  isSportsTopic,
} from '@/lib/account-topic-policy';
import {
  ANTIFUND_PORTFOLIO_COMPANIES,
  buildAntiFundPortfolioContext,
} from '@/lib/antifund-portfolio';
import { getAccountPublishingPolicyIssue } from '@/lib/account-publish-policy';

const geoffreyVoiceProfile = {
  tone: 'casual and direct',
  topics: ['AI', 'startups', 'sports'],
  antiGoals: ['generic explainers'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed native voice.',
  summary: 'A startup investor and operator.',
};

describe('account topic policy', () => {
  it('blocks explicit and semantically classified sports for @geoffwoo', () => {
    expect(ACCOUNT_TOPIC_POLICY_VERSION).toBe('account-topic-policy-2');
    expect(isSportsTopic('NBA defensive three seconds')).toBe(true);
    expect(isSportsTopic('PFL and MVP boxing merger')).toBe(true);
    expect(isSportsTopic('Wemby changes the geometry of the court')).toBe(true);
    expect(isSportsTopic('unlabeled signal', 'sports_competition')).toBe(true);
    expect(getAccountTopicPolicyIssue('geoffwoo', 'Caitlin Clark road games')).toMatch(/excludes sports/i);
    expect(getVoiceProfileTopicPolicyIssue(geoffreyVoiceProfile, 'NFL season')).toMatch(/excludes sports/i);
  });

  it('allows sports-adjacent portfolio companies only for a company-business angle', () => {
    const betrContext = buildAntiFundPortfolioContext(
      ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'betr')!,
      'constructive_conviction',
    );
    const companyPost = 'Betr can build the consumer brand and media distribution layer for sports betting.';
    const randomSportsPost = "Betr should take the odds on tonight's UFC matchup.";

    expect(isQualifiedSportsPortfolioContext(companyPost, betrContext)).toBe(true);
    expect(getAccountTopicPolicyIssue('geoffwoo', companyPost, null, betrContext)).toBeNull();
    expect(isQualifiedSportsPortfolioContext(randomSportsPost, betrContext)).toBe(false);
    expect(getAccountTopicPolicyIssue('geoffwoo', randomSportsPost, null, betrContext)).toMatch(/excludes sports/i);
    expect(getAccountTopicPolicyIssue('geoffwoo', companyPost)).toMatch(/excludes sports/i);
    expect(getAccountTopicPolicyIssue(
      'geoffwoo',
      'Betr business will sign this NBA player tonight.',
      null,
      betrContext,
    )).toMatch(/excludes sports/i);
  });

  it('applies the same narrow exception at the final account publishing gate', () => {
    const betrContext = buildAntiFundPortfolioContext(
      ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'betr')!,
      'constructive_conviction',
    );

    expect(getAccountPublishingPolicyIssue({
      handle: 'geoffwoo',
      content: 'Betr can build the consumer media and distribution layer for sports betting.',
      portfolioCompanyContext: betrContext,
    })).toBeNull();
    expect(getAccountPublishingPolicyIssue({
      handle: 'geoffwoo',
      content: 'Betr product will sign this NBA player tonight.',
      portfolioCompanyContext: betrContext,
    })).toMatch(/excludes sports/i);
    expect(getAccountPublishingPolicyIssue({
      handle: 'geoffwoo',
      content: 'this NBA player is special tonight',
    })).toMatch(/excludes sports/i);
  });

  it('does not block business competition or sports for unrelated accounts', () => {
    expect(isSportsTopic('startup competition and market structure')).toBe(false);
    expect(getAccountTopicPolicyIssue('anotherfounder', 'NBA expansion')).toBeNull();
    expect(getAccountTopicPolicyIssue('geoffwoo', 'OpenAI startup competition')).toBeNull();
  });
});
