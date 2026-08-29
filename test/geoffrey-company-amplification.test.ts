import { describe, expect, it } from 'vitest';
import {
  GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION,
  GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES,
  GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES,
  getGeoffreyCompanyAmplificationIssue,
  getGeoffreyVoiceProfileCompanyAmplificationIssue,
} from '@/lib/geoffrey-company-amplification';

const geoffreyVoiceProfile = {
  tone: 'casual and direct',
  topics: ['AI', 'startups'],
  antiGoals: ['generic explainers'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed native voice.',
  summary: 'A startup investor and operator.',
};

describe('Geoffrey company amplification policy', () => {
  it('suppresses Cursor across tagged and lowercase generated subject surfaces', () => {
    expect(GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION).toBe('geoffrey-company-amplification-1');
    expect(GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES).toEqual(['Cursor']);
    expect(GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES).toEqual(['OpenAI', 'Cognition']);
    expect(getGeoffreyCompanyAmplificationIssue(
      'geoffwoo',
      'i would value @cursor_ai above every independent model startup',
    )).toMatch(/suppresses Cursor/i);
    expect(getGeoffreyCompanyAmplificationIssue('geoffwoo', 'cursor startup valuation')).toMatch(/suppresses Cursor/i);
    expect(getGeoffreyVoiceProfileCompanyAmplificationIssue(
      geoffreyVoiceProfile,
      'Cursor controls model distribution',
    )).toMatch(/suppresses Cursor/i);
  });

  it('does not alter unrelated accounts or preferred company subjects', () => {
    expect(getGeoffreyCompanyAmplificationIssue('anotherfounder', 'Cursor startup valuation')).toBeNull();
    expect(getGeoffreyCompanyAmplificationIssue('geoffwoo', 'OpenAI and Cognition')).toBeNull();
  });
});
