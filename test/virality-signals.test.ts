import { describe, expect, it } from 'vitest';
import { assessFormulaicCadence, assessTasteRisk, assessTechnicalElevation, blendedCringeRisk, computeActionRewards, getAuthorityProofIssue, getReplyOptOutReason, hasConcreteNumericAnchor, hasSpecificQuantity, scoreConversationValue, scoreHighValueReply, scoreSlopRisk, scoreViralityUpside } from '@/lib/virality-signals';
import type { TweetPerformance } from '@/lib/types';

function performance(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: 'tweet-1',
    xTweetId: 'x-1',
    content: 'AI agents need evals before autonomy, not after the demo.',
    format: 'hot_take',
    topic: 'AI',
    postedAt: '2026-04-07T12:00:00.000Z',
    checkedAt: '2026-04-07T12:30:00.000Z',
    likes: 20,
    retweets: 4,
    replies: 6,
    impressions: 1200,
    engagementRate: 2.5,
    wasViral: false,
    source: 'autopilot',
    ...overrides,
  };
}

describe('virality signals', () => {
  it('scores substantive replies above generic praise and spam', () => {
    const highValue = scoreHighValueReply({
      text: 'What eval would you run before letting an AI agent touch production workflows?',
      authorUsername: 'builder',
    }, { topics: ['AI', 'agents'] });
    const praise = scoreHighValueReply({ text: 'nice', authorUsername: 'fan' }, { topics: ['AI'] });
    const spam = scoreHighValueReply({ text: 'check this giveaway https://example.com', authorUsername: 'promo' }, { topics: ['AI'] });

    expect(highValue.score).toBeGreaterThanOrEqual(0.58);
    expect(highValue.responseStrategy).toBe('answer_question');
    expect(praise.score).toBeLessThan(0.5);
    expect(spam.score).toBeLessThan(0.5);
  });

  it('scores contextual conversation prompts above generic engagement bait', () => {
    const generic = scoreConversationValue('Thoughts on AI agents?', {
      hook: 'question',
      tone: 'casual',
      specificity: 'abstract',
      structure: 'question_led',
      thesis: 'ai agents thoughts',
      riskFlags: ['thin'],
    });
    const substantive = scoreConversationValue(
      'AI agents get safer when every failed eval creates a 24-hour rollback rule. Where does this break in your workflow?',
      {
        hook: 'question',
        tone: 'analytical',
        specificity: 'tactical',
        structure: 'question_led',
        thesis: 'agent eval rollback workflow',
        riskFlags: [],
      },
    );

    expect(generic).toBeLessThan(0.35);
    expect(substantive).toBeGreaterThan(0.65);
  });

  it('turns observed actions into a bounded reward vector', () => {
    const rewards = computeActionRewards(performance({
      likes: 36,
      retweets: 8,
      replies: 10,
      impressions: 3000,
      engagementRate: 1.8,
    }), { avgLikes: 12, avgRetweets: 2 });

    expect(rewards.likeReward).toBeGreaterThan(0);
    expect(rewards.replyReward).toBeGreaterThan(0);
    expect(rewards.repostReward).toBeGreaterThan(0);
    expect(rewards.highQualityReplyReward).toBeGreaterThan(0);
    expect(rewards.qualityAdjustedGrowthScore).toBeGreaterThan(50);
    expect(rewards.total).toBeLessThanOrEqual(0.9);
  });

  it('uses direct quote and bookmark outcomes instead of a like-based bookmark proxy', () => {
    const rewards = computeActionRewards(performance({
      likes: 8,
      retweets: 3,
      replies: 2,
      quotes: 7,
      bookmarks: 12,
    }), {
      avgLikes: 12,
      avgRetweets: 2,
      avgQuotes: 1,
      avgBookmarks: 2,
    });

    expect(rewards.quoteReward).toBeGreaterThan(0);
    expect(rewards.bookmarkReward).toBeGreaterThan(0);
    expect(rewards.bookmarkProxyReward).toBe(0);
  });

  it('boosts known relationship targets in reply scoring', () => {
    const unknown = scoreHighValueReply({
      text: 'Can you give a concrete example of this?',
      authorUsername: 'newperson',
    }, { topics: ['AI'] });
    const known = scoreHighValueReply({
      text: 'Can you give a concrete example of this?',
      authorUsername: 'knownbuilder',
    }, {
      topics: ['AI'],
      relationshipHandles: [{ handle: 'knownbuilder', interactions: 5, avgEngagement: 20 }],
    });

    expect(known.score).toBeGreaterThan(unknown.score);
    expect(known.reason).toContain('known relationship target');
  });

  it('detects explicit reply opt-out language without treating generic stop words as opt-outs', () => {
    expect(getReplyOptOutReason('please stop replying to me')).toContain('stop contacting');
    expect(getReplyOptOutReason('do not tag us again')).toContain('asked not to receive');
    expect(getReplyOptOutReason('unsubscribe')).toContain('opt-out');
    expect(getReplyOptOutReason('stop optimizing for demos and start shipping')).toBeNull();
  });

  it('requires proof or mechanism for broad authority claims', () => {
    expect(getAuthorityProofIssue('Everyone building AI agents is wrong')).toContain('Authority gate');
    expect(getAuthorityProofIssue('Everyone building AI agents is wrong because evals collapse when memory drifts')).toBeNull();
    expect(getAuthorityProofIssue('Most AI agent demos optimize for applause. Production agents optimize for boring recovery paths.')).toBeNull();
  });

  it('flags recognizable AI-post cadence more than concrete human observations', () => {
    const generic = scoreSlopRisk(
      'The real edge in AI agents is not the demo, but the feedback loop. Most people are still optimizing for optics. The winners will be the teams that build systems where learning compounds.',
      {
        hook: 'bold_claim',
        tone: 'analytical',
        specificity: 'abstract',
        structure: 'argument',
        thesis: 'ai agents feedback loop compounds',
        riskFlags: [],
      },
    );
    const concrete = scoreSlopRisk(
      'The weird tell on agent teams: nobody knows who owns the rollback button after the first failed eval. That is usually where the autonomy roadmap quietly dies.',
      {
        hook: 'observation',
        tone: 'analytical',
        specificity: 'tactical',
        structure: 'single_punch',
        thesis: 'agent teams need rollback ownership',
        riskFlags: [],
      },
    );

    expect(generic).toBeGreaterThanOrEqual(0.55);
    expect(concrete).toBeLessThan(0.25);
  });

  it('treats banal SaaS ops texture as weaker than hard technical anchors', () => {
    const ops = scoreSlopRisk(
      'AI adoption gets real when a Slack channel gets quieter and the support queue stops lighting up after the workflow handoff changes.',
      {
        hook: 'observation',
        tone: 'analytical',
        specificity: 'concrete',
        structure: 'single_punch',
        thesis: 'slack support queue adoption proof',
        riskFlags: [],
      },
    );
    const technical = scoreSlopRisk(
      'Inference ASIC adoption gets real when HBM bandwidth, packaging yield, and rack power density survive the next model shape change.',
      {
        hook: 'observation',
        tone: 'analytical',
        specificity: 'tactical',
        structure: 'single_punch',
        thesis: 'inference asic deployment constraints',
        riskFlags: [],
      },
    );
    const opsElevation = assessTechnicalElevation('Slack channel, support ticket, dashboard, workflow handoff.');
    const technicalElevation = assessTechnicalElevation('HBM bandwidth, packaging yield, power density, thermal limits.');

    expect(ops).toBeGreaterThan(technical);
    expect(opsElevation.banalOpsScore).toBeGreaterThan(0);
    expect(opsElevation.hasHardTechAnchor).toBe(false);
    expect(technicalElevation.technicalScore).toBeGreaterThan(0);
    expect(technicalElevation.hasHardTechAnchor).toBe(true);
  });

  it('separates formulaic cadence from concrete operator evidence', () => {
    const formulaic = assessFormulaicCadence(
      'The real edge in AI agents is not the demo, but the feedback loop. Most people miss this. The winners will be the teams where learning compounds.'
    );
    const concrete = assessFormulaicCadence(
      'The weird tell on agent teams: nobody knows who owns the rollback button after the first failed eval.'
    );

    expect(formulaic.score).toBeGreaterThanOrEqual(0.5);
    expect(formulaic.hits).toContain('the-real-x');
    expect(formulaic.hits).toContain('not-x-but-y');
    expect(concrete.score).toBeLessThan(0.2);
    expect(concrete.hasConcreteAnchor).toBe(true);
  });

  it('does not treat listicle counts, bare digits, or label numbers as concrete anchors', () => {
    expect(hasConcreteNumericAnchor('5 things I learned about distribution')).toBe(false);
    expect(hasConcreteNumericAnchor('3 reasons your startup will fail')).toBe(false);
    expect(hasConcreteNumericAnchor('1. build\n2. ship\n3. learn')).toBe(false);
    expect(hasConcreteNumericAnchor('I have 3 rules for hiring')).toBe(false);
    expect(hasConcreteNumericAnchor('version 12 shipped today')).toBe(false);
    expect(hasConcreteNumericAnchor('3 big shifts are coming for founders')).toBe(false);

    expect(hasConcreteNumericAnchor('churn dropped 8% after the pricing change')).toBe(true);
    expect(hasConcreteNumericAnchor('churn dropped 12% after the pricing change')).toBe(true);
    expect(hasConcreteNumericAnchor('a $40 dispute took 3 hours of support time')).toBe(true);
    expect(hasConcreteNumericAnchor('inference cost fell 3.5x in a year')).toBe(true);
    expect(hasConcreteNumericAnchor('the eval ran for 24-hour cycles')).toBe(true);
  });

  it('separates specific quantities from measured factual proof', () => {
    expect(hasConcreteNumericAnchor('we talked to 8 founders about pricing')).toBe(false);
    expect(hasSpecificQuantity('we talked to 8 founders about pricing')).toBe(true);
    expect(hasSpecificQuantity('we shipped 47 drafts before one landed')).toBe(true);
    expect(hasSpecificQuantity('churn dropped 8%')).toBe(true);

    expect(hasSpecificQuantity('5 things I learned about distribution')).toBe(false);
    expect(hasSpecificQuantity('version 12 shipped today')).toBe(false);
    expect(hasSpecificQuantity('1. build\n2. ship\n3. learn')).toBe(false);
  });

  it('flags abstract listicles that previously hid behind their own count numbers', () => {
    const listicle = assessFormulaicCadence(
      '5 things most people miss about leverage:\n1. distribution is the real moat\n2. narrative compounds\n3. systems beat velocity'
    );
    expect(listicle.hasConcreteAnchor).toBe(false);
    expect(listicle.hits).toContain('neat-numbered-scaffold');
    expect(listicle.hits).toContain('abstract-stack-without-proof');

    const measured = assessFormulaicCadence(
      'Queue review this week:\n1. slop rate fell to 8%\n2. approvals up 3x\n3. two drafts deleted after posting'
    );
    expect(measured.hasConcreteAnchor).toBe(true);
    expect(measured.hits).not.toContain('neat-numbered-scaffold');
  });

  it('rewards profile-click rate above baseline and ignores it when unavailable', () => {
    const base = (overrides: Partial<TweetPerformance> = {}): TweetPerformance => ({
      tweetId: 't-1',
      xTweetId: 'x-1',
      content: 'a take with some substance about startups and capital allocation.',
      format: 'hot_take',
      topic: 'startups',
      hook: 'bold_claim',
      tone: 'direct',
      specificity: 'concrete',
      structure: 'single_punch',
      thesis: 'startups capital',
      postedAt: '2026-08-29T00:00:00.000Z',
      checkedAt: '2026-08-30T00:00:00.000Z',
      likes: 20,
      retweets: 3,
      replies: 2,
      impressions: 10000,
      engagementRate: 3,
      wasViral: false,
      source: 'autopilot',
      ...overrides,
    } as TweetPerformance);

    const strong = computeActionRewards(base({ profileClicks: 120 }));
    const weak = computeActionRewards(base({ profileClicks: 10 }));
    const absent = computeActionRewards(base({ profileClicks: null }));
    const thinReach = computeActionRewards(base({ profileClicks: 50, impressions: 150 }));

    // 1.2% click rate clears the 0.4% baseline; 0.1% lands below it.
    expect(strong.profileClickReward).toBeGreaterThan(0.2);
    expect(weak.profileClickReward).toBeLessThan(0);
    expect(strong.total).toBeGreaterThan(absent.total);
    // Missing metrics and sub-200-impression samples contribute nothing.
    expect(absent.profileClickReward).toBe(0);
    expect(thinReach.profileClickReward).toBe(0);
  });

  it('blends cringe estimators so one mild outlier cannot veto two clean reads', () => {
    // One mildly elevated estimator, two clean: passes the 0.32 gate.
    expect(blendedCringeRisk([0.35, 0.08, 0.08])).toBeLessThan(0.32);
    // Cross-estimator agreement still rejects.
    expect(blendedCringeRisk([0.36, 0.34, 0.3])).toBeGreaterThanOrEqual(0.32);
    // A single confident estimator still rejects on its own.
    expect(blendedCringeRisk([0.62, 0.05, 0.05])).toBeGreaterThanOrEqual(0.32);
    expect(blendedCringeRisk([])).toBe(0);
    expect(blendedCringeRisk([1.4, -0.2])).toBeLessThanOrEqual(1);
  });

  it('scores conversational contrarian drafts above flat statements for virality upside', () => {
    const tags = (overrides: Partial<Parameters<typeof scoreViralityUpside>[1]> = {}) => ({
      hook: 'observation',
      tone: 'direct',
      specificity: 'concrete',
      structure: 'single_claim',
      riskFlags: [] as string[],
      ...overrides,
    }) as Parameters<typeof scoreViralityUpside>[1];

    const debate = scoreViralityUpside(
      'Serious question: if coding agents already write 40% of production commits, why is every AI IDE still priced per seat? What am I missing about the margin math when usage decouples from headcount?',
      tags({ hook: 'question' }),
    );
    const flat = scoreViralityUpside(
      'Enterprise software pricing continues to evolve as the market matures.',
      tags({ specificity: 'abstract' }),
    );

    expect(debate).toBeGreaterThan(flat);
    expect(debate).toBeGreaterThan(0.5);
    expect(flat).toBeLessThanOrEqual(0.45);
    expect(debate).toBeLessThanOrEqual(1);
    expect(flat).toBeGreaterThanOrEqual(0);
  });

  it('holds embarrassing replies while allowing sharp substantive posts', () => {
    const bad = assessTasteRisk('you are a stupid clown lol', { surface: 'reply', highValueScore: 0.6 });
    const sharp = assessTasteRisk(
      'Most AI agent demos optimize for applause. Production agents optimize for boring recovery paths.',
      { surface: 'post', policyRiskScore: 0.08, creativeRiskScore: 0.22, slopScore: 0.12, voiceScore: 0.78 },
    );

    expect(bad.action).toBe('block');
    expect(sharp.action).toBe('allow');
  });
});
