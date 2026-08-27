import { describe, expect, it } from 'vitest';
import { buildAntiFundPortfolioContext, ANTIFUND_PORTFOLIO_COMPANIES } from '@/lib/antifund-portfolio';
import { canonicalizeLearningTopic, isEligibleForAccountPolicyLearning } from '@/lib/learning-topic';

describe('learning topic policy', () => {
  it('canonicalizes fragmented AI labels without confusing Servo browser infrastructure for robotics', () => {
    expect(canonicalizeLearningTopic({ topic: 'AI/ML', content: 'model capability update' })).toBe('ai');
    expect(canonicalizeLearningTopic({ topic: 'openai', content: 'ChatGPT adoption' })).toBe('ai');
    expect(canonicalizeLearningTopic({ topic: 'technology', content: 'Servo browser rendering engine ships better CSS support' })).toBe('software');
    expect(canonicalizeLearningTopic({ topic: 'investing', content: 'NVIDIA AI demand is intact' })).toBe('investing');
    expect(canonicalizeLearningTopic({ topic: 'modal versus databricks ipo timing', content: 'a named timing call' })).toBe('general');
  });

  it('excludes random sports from Geoffrey learning while preserving qualified portfolio business posts', () => {
    const agent = { handle: 'geoffwoo' };
    const betr = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'betr')!;
    const context = buildAntiFundPortfolioContext(betr, 'constructive_conviction');

    expect(isEligibleForAccountPolicyLearning(agent, {
      tweetId: 'sports-1',
      xTweetId: 'x-sports-1',
      topic: 'sports',
      content: 'this NBA player should be MVP tonight',
    })).toBe(false);
    expect(isEligibleForAccountPolicyLearning(agent, {
      tweetId: 'betr-1',
      xTweetId: 'x-betr-1',
      topic: 'sports business',
      content: 'Betr can turn creator distribution into a much larger sports betting brand.',
    }, [{
      id: 'betr-1',
      xTweetId: 'x-betr-1',
      portfolioCompanyContext: context,
    } as any])).toBe(true);
  });
});
