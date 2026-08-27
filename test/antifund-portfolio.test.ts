import { describe, expect, it } from 'vitest';
import {
  ANTIFUND_PORTFOLIO_COMPANIES,
  ANTIFUND_PORTFOLIO_POLICY_VERSION,
  ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
  ANTIFUND_PORTFOLIO_SNAPSHOT_EXPIRES_AT,
  ANTIFUND_PROMOTION_COMPANIES,
  buildAntiFundPortfolioContext,
  findAntiFundPortfolioCompanies,
  findSingleAntiFundPortfolioCompany,
  findOfficialAntiFundPortfolioPublisher,
  getAntiFundPortfolioContextIssues,
  getAntiFundPortfolioPolicyIssues,
  isAntiFundPortfolioBriefDue,
  isAntiFundPortfolioPromotionEligible,
  resolveAntiFundPortfolioContext,
  selectAntiFundPortfolioCompany,
} from '@/lib/antifund-portfolio';

describe('Anti Fund portfolio generation policy', () => {
  it('keeps the official portfolio broad and marks sports-adjacent companies for a narrower business rule', () => {
    expect(ANTIFUND_PORTFOLIO_COMPANIES).toHaveLength(51);
    expect(ANTIFUND_PROMOTION_COMPANIES).toHaveLength(17);
    expect(ANTIFUND_PROMOTION_COMPANIES.map((company) => company.name)).toEqual([
      'OpenAI',
      'Anduril',
      'Helion',
      'Saronic',
      'General Matter',
      'Cognition',
      'Etched',
      'Physical Intelligence',
      'Ramp',
      'ElevenLabs',
      'Polymarket',
      'Kings League',
      'Ketone-IQ',
      'Eight Sleep',
      'Betr',
      'Chronosphere',
      'SpaceX',
    ]);
    expect(ANTIFUND_PORTFOLIO_COMPANIES.filter((company) => company.sportsAdjacent).map((company) => company.name)).toEqual([
      'Kings League',
      'Betr',
    ]);
    expect(ANTIFUND_PROMOTION_COMPANIES.every((company) => company.officialXHandles.length > 0)).toBe(true);
    expect(ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'elevenlabs')?.officialXHandles).toEqual(['elevenlabs']);
    expect(ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'modal')?.officialXHandles).toEqual(['modal']);
    expect(findAntiFundPortfolioCompanies('i think Etched gets to the next rack faster than people expect').map((company) => company.name)).toContain('Etched');
    expect(findAntiFundPortfolioCompanies('Betr should own sports media').map((company) => company.name)).toContain('Betr');
  });

  it('hard-excludes Natural and keeps ordinary portfolio companies outside automatic promotion', () => {
    const natural = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'natural')!;
    const melius = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'melius')!;

    expect(natural.promotionTier).toBe('excluded');
    expect(melius.promotionTier).toBe('standard');
    expect(isAntiFundPortfolioPromotionEligible(natural)).toBe(false);
    expect(isAntiFundPortfolioPromotionEligible(melius)).toBe(false);
    expect(getAntiFundPortfolioContextIssues(
      buildAntiFundPortfolioContext(natural, 'constructive_conviction'),
      new Date('2026-08-22T00:00:00.000Z'),
    )).toEqual(expect.arrayContaining([
      'portfolio_company_promotion_excluded',
      'portfolio_company_not_flagship',
    ]));
    expect(getAntiFundPortfolioPolicyIssues(
      'Natural can own payments infrastructure for AI agents.',
    )).toEqual(expect.arrayContaining([
      'portfolio_company_promotion_excluded',
      'portfolio_company_not_flagship',
    ]));
    expect(getAntiFundPortfolioPolicyIssues('Natural will win.')).toContain(
      'portfolio_company_promotion_excluded',
    );
    expect(getAntiFundPortfolioPolicyIssues('Natural language models keep improving.')).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues(
      'Melius can build the creative workspace for AI agents.',
      buildAntiFundPortfolioContext(melius, 'constructive_conviction'),
    )).toContain('portfolio_company_not_flagship');
    expect(getAntiFundPortfolioPolicyIssues(
      'Melius released a new creative workspace for AI agents.',
    )).toEqual([]);
  });

  it('rotates only across the flagship promotion set', () => {
    const selected = new Set(Array.from({ length: 250 }, (_, index) => (
      selectAntiFundPortfolioCompany([], `rotation-${index}`)?.id
    )).filter(Boolean));

    expect(selected.has('natural')).toBe(false);
    expect([...selected].every((id) => ANTIFUND_PROMOTION_COMPANIES.some((company) => company.id === id))).toBe(true);
    expect(ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION).toBe('antifund-flagship-promotion-1');
  });

  it('recognizes exact official company accounts as first-party portfolio sources', () => {
    expect(findOfficialAntiFundPortfolioPublisher('@Etched')).toMatchObject({
      id: 'etched',
      name: 'Etched',
    });
    expect(findOfficialAntiFundPortfolioPublisher('@random_commentator')).toBeNull();
  });

  it('does not infer generic portfolio names from unrelated prose or ambiguous stories', () => {
    const unrelated = 'Natural language models improve after the Archive team decides to Merge workflows and Ramp adoption.';
    expect(findAntiFundPortfolioCompanies(unrelated)).toEqual([]);
    expect(findAntiFundPortfolioCompanies('Ramp launches a new finance product.', {
      exactEntities: ['Ramp'],
    }).map((company) => company.name)).toContain('Ramp');
    expect(findSingleAntiFundPortfolioCompany('OpenAI and Etched announce a shared benchmark.')).toBeNull();
  });

  it('allows constructive conviction but rejects criticism, fake access, ads, and dropped subjects', () => {
    const etched = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'etched')!;
    const context = buildAntiFundPortfolioContext(etched, 'constructive_conviction');

    expect(context.policyVersion).toBe(ANTIFUND_PORTFOLIO_POLICY_VERSION);
    expect(context.snapshotExpiresAt).toBe(ANTIFUND_PORTFOLIO_SNAPSHOT_EXPIRES_AT);
    expect(getAntiFundPortfolioPolicyIssues(
      'i think Etched gets to the next rack faster than people expect.',
      context,
    )).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues(
      'Etched shipping its first rack to Jane Street is the endorsement I would put above the valuation.',
      context,
    )).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues(
      'Jane Street receiving the first Etched rack makes this round unusually concrete.',
      context,
    )).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues(
      'Etched has earned the right to make the valuation sound less hypothetical.',
      context,
    )).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues('Etched is overrated and cannot compete.', context)).toContain('portfolio_disparagement');
    expect(getAntiFundPortfolioPolicyIssues('we met the Etched team and they showed me the next chip.', context)).toContain('portfolio_invented_access');
    expect(getAntiFundPortfolioPolicyIssues('check Etched out and sign up now.', context)).toContain('portfolio_ad_copy');
    expect(getAntiFundPortfolioPolicyIssues('this company will be huge.', context)).toContain('portfolio_company_dropped');
    expect(getAntiFundPortfolioPolicyIssues('OpenAI should be stopped.', buildAntiFundPortfolioContext(
      ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'openai')!,
      'constructive_conviction',
    ))).toContain('portfolio_disparagement');
    expect(getAntiFundPortfolioPolicyIssues('OpenAI can harm users.', buildAntiFundPortfolioContext(
      ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'openai')!,
      'constructive_conviction',
    ))).toContain('portfolio_disparagement');
    expect(getAntiFundPortfolioPolicyIssues('OpenAI will collapse.', buildAntiFundPortfolioContext(
      ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'openai')!,
      'constructive_conviction',
    ))).toContain('portfolio_disparagement');
  });

  it('rejects stale or forged context and rebuilds operator edits from the canonical registry', () => {
    const betr = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'betr')!;
    const canonical = buildAntiFundPortfolioContext(betr, 'constructive_conviction');
    const forged = { ...canonical, companyName: 'NBA', policyVersion: 'old-policy' };

    expect(getAntiFundPortfolioContextIssues(forged, new Date('2026-08-22T00:00:00.000Z'))).toEqual(expect.arrayContaining([
      'portfolio_context_policy_stale',
      'portfolio_context_canonical_mismatch',
    ]));
    expect(getAntiFundPortfolioContextIssues(canonical, new Date('2026-11-20T00:00:00.000Z'))).toContain(
      'portfolio_context_snapshot_expired',
    );
    expect(resolveAntiFundPortfolioContext(
      'Betr can build a much bigger consumer media brand.',
      forged,
    )).toEqual(canonical);
  });

  it('allows Betr and Kings League company strategy but blocks random sports or player takes', () => {
    const betr = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'betr')!;
    const kingsLeague = ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === 'kings-league')!;
    const betrContext = buildAntiFundPortfolioContext(betr, 'constructive_conviction');
    const kingsContext = buildAntiFundPortfolioContext(kingsLeague, 'constructive_conviction');

    expect(getAntiFundPortfolioPolicyIssues(
      'Betr can build the consumer media and distribution brand for sports betting.',
      betrContext,
    )).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues(
      "Kings League's creator format can expand the global soccer audience.",
      kingsContext,
    )).toEqual([]);
    expect(getAntiFundPortfolioPolicyIssues(
      "Betr should take the odds on tonight's UFC matchup.",
      betrContext,
    )).toContain('portfolio_sports_business_relevance_missing');
    expect(getAntiFundPortfolioPolicyIssues(
      'Kings League should sign this player after the game tonight.',
      kingsContext,
    )).toContain('portfolio_sports_business_relevance_missing');
    expect(getAntiFundPortfolioPolicyIssues(
      'Betr business will sign this NBA player tonight.',
      betrContext,
    )).toContain('portfolio_sports_business_relevance_missing');
  });

  it('targets two portfolio subjects in the last five without forcing every slot', () => {
    const base = (id: string, content: string) => ({
      id,
      agentId: 'agent-1',
      content,
      type: 'original',
      status: 'posted',
      topic: 'startups',
      xTweetId: id,
      createdAt: '2026-08-21T00:00:00.000Z',
    }) as any;

    expect(isAntiFundPortfolioBriefDue([
      base('1', 'generic AI prediction'),
      base('2', 'another startup thought'),
      base('3', 'founder capital markets'),
      base('4', 'software company quality'),
      base('5', 'a market question'),
    ])).toBe(true);
    expect(isAntiFundPortfolioBriefDue([
      base('1', 'i think Etched gets there faster'),
      base('2', 'Cognition will be a massive company'),
      base('3', 'founder capital markets'),
      base('4', 'software company quality'),
      base('5', 'a market question'),
    ])).toBe(false);
    expect(isAntiFundPortfolioBriefDue([
      { ...base('1', 'i think Etched gets there faster'), status: 'deleted_from_x' },
      base('2', 'Cognition will be a massive company'),
      base('3', 'founder capital markets'),
      base('4', 'software company quality'),
      base('5', 'a market question'),
    ])).toBe(true);
    expect(isAntiFundPortfolioBriefDue([
      base('1', 'generic AI prediction'),
      base('2', 'another startup thought'),
      base('3', 'founder capital markets'),
    ], [{
      id: 'signal-1',
      agentId: 'agent-1',
      tweetId: 'deleted-portfolio-draft',
      signalType: 'deleted_from_queue',
      surface: 'queue',
      rewardDelta: -0.75,
      createdAt: '2026-08-21T12:00:00.000Z',
      metadata: { portfolioCompanyId: 'betr' },
    }], new Date('2026-08-21T18:00:00.000Z'))).toBe(false);
  });
});
