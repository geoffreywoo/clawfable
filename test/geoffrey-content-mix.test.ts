import { describe, expect, it } from 'vitest';
import {
  GEOFFREY_COMPANY_LED_WINDOW,
  GEOFFREY_CONTENT_MIX_POLICY_VERSION,
  GEOFFREY_STANDING_PROMOTION_WINDOW,
  evaluateGeoffreyQueueContentMix,
  getGeoffreyContentMixDecision,
  isCompanyLedGeoffreyPost,
  isStandingCompanyPromotionGeoffreyPost,
} from '@/lib/geoffrey-content-mix';

const post = (id: string, content: string, createdAt: string, status = 'posted') => ({
  id,
  content,
  topic: 'startups',
  type: 'original',
  status,
  createdAt,
});

describe('Geoffrey company-led content mix', () => {
  it('separates company-led posts from standalone ideas', () => {
    expect(GEOFFREY_CONTENT_MIX_POLICY_VERSION).toBe('geoffrey-content-mix-1');
    expect(GEOFFREY_COMPANY_LED_WINDOW).toBe(5);
    expect(GEOFFREY_STANDING_PROMOTION_WINDOW).toBe(10);
    expect(isCompanyLedGeoffreyPost({ content: 'i would buy @Microsoft for the next 12 months' })).toBe(true);
    expect(isCompanyLedGeoffreyPost({ content: 'i would buy @newstartup after this funding round' })).toBe(true);
    expect(isCompanyLedGeoffreyPost({ content: "Devin's biggest scaling cost will be failed context recovery" })).toBe(true);
    expect(isCompanyLedGeoffreyPost({ content: 'ChatGPT is becoming the default interface for work' })).toBe(true);
    expect(isCompanyLedGeoffreyPost({ content: 'software agents should kill the weekly status meeting' })).toBe(false);
    expect(isCompanyLedGeoffreyPost({ content: 'founders are going to hire much smaller teams' })).toBe(false);
  });

  it('identifies explicit promotion more narrowly than company subject matter', () => {
    expect(isStandingCompanyPromotionGeoffreyPost({
      content: "i'd pay a brutal price for @cognition ownership",
    })).toBe(true);
    expect(isStandingCompanyPromotionGeoffreyPost({
      content: "within 12 months Devin's biggest scaling cost will be failed context recovery",
    })).toBe(false);
  });

  it('allows one company-led post only after four non-company originals', () => {
    const history = [
      post('company', 'OpenAI will absorb a lot more software work', '2026-08-30T12:00:00.000Z'),
      post('idea-1', 'founders will run much smaller teams', '2026-08-30T13:00:00.000Z'),
      post('idea-2', 'agent retries become a real budget line', '2026-08-30T14:00:00.000Z'),
      post('idea-3', 'software margins get stranger from here', '2026-08-30T15:00:00.000Z'),
    ];
    expect(getGeoffreyContentMixDecision(
      { content: 'Cognition will become a generational company' },
      history,
    ).reasonCode).toBe('company_led_recent_window');

    history.push(post('idea-4', 'the best startups will look understaffed', '2026-08-30T16:00:00.000Z'));
    expect(getGeoffreyContentMixDecision(
      { content: 'Cognition will become a generational company' },
      history,
    ).allowed).toBe(true);
  });

  it('keeps explicit company conviction to one in ten even after the company slot reopens', () => {
    const history = [
      post('promotion', "i'd buy @OpenAI above a trillion", '2026-08-30T08:00:00.000Z'),
      ...Array.from({ length: 5 }, (_, index) => post(
        `idea-${index}`,
        `standalone startup idea ${index}`,
        `2026-08-30T1${index}:00:00.000Z`,
      )),
    ];
    expect(getGeoffreyContentMixDecision(
      { content: "i'd pay a stupid price for @SpaceX ownership" },
      history,
    ).reasonCode).toBe('standing_promotion_recent_window');
    expect(getGeoffreyContentMixDecision(
      { content: 'SpaceX launch cadence changes satellite company formation' },
      history,
    ).allowed).toBe(true);
  });

  it('reserves at most one company-led queue slot and keeps the strongest eligible draft', () => {
    const queue = [
      { ...post('weak', 'OpenAI becomes the default work interface', '2026-08-30T12:00:00.000Z', 'queued'), finalCriticScores: { qualityMargin: 0.82 } },
      { ...post('strong', 'Devin makes software retries a real budget line', '2026-08-30T13:00:00.000Z', 'queued'), finalCriticScores: { qualityMargin: 0.94 } },
      post('idea', 'the best startups will look understaffed', '2026-08-30T14:00:00.000Z', 'queued'),
    ];
    const decisions = evaluateGeoffreyQueueContentMix(queue as any, []);
    expect(decisions.get('strong')).toMatchObject({ allowed: true, companyLed: true });
    expect(decisions.get('weak')).toMatchObject({ allowed: false, reasonCode: 'company_led_queue_reservation' });
    expect(decisions.get('idea')).toMatchObject({ allowed: true, companyLed: false });
  });
});
