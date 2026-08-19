import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TOPIC_POLICY_VERSION,
  getAccountTopicPolicyIssue,
  getVoiceProfileTopicPolicyIssue,
  isSportsTopic,
} from '@/lib/account-topic-policy';

const geoffreyVoiceProfile = {
  tone: 'casual and direct',
  topics: ['AI', 'startups', 'sports'],
  antiGoals: ['generic explainers'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed native voice.',
  summary: 'A startup investor and operator.',
};

describe('account topic policy', () => {
  it('blocks explicit and semantically classified sports for @geoffwoo', () => {
    expect(ACCOUNT_TOPIC_POLICY_VERSION).toBe('account-topic-policy-1');
    expect(isSportsTopic('NBA defensive three seconds')).toBe(true);
    expect(isSportsTopic('PFL and MVP boxing merger')).toBe(true);
    expect(isSportsTopic('Wemby changes the geometry of the court')).toBe(true);
    expect(isSportsTopic('unlabeled signal', 'sports_competition')).toBe(true);
    expect(getAccountTopicPolicyIssue('geoffwoo', 'Caitlin Clark road games')).toMatch(/excludes sports/i);
    expect(getVoiceProfileTopicPolicyIssue(geoffreyVoiceProfile, 'NFL season')).toMatch(/excludes sports/i);
  });

  it('does not block business competition or sports for unrelated accounts', () => {
    expect(isSportsTopic('startup competition and market structure')).toBe(false);
    expect(getAccountTopicPolicyIssue('anotherfounder', 'NBA expansion')).toBeNull();
    expect(getAccountTopicPolicyIssue('geoffwoo', 'OpenAI startup competition')).toBeNull();
  });
});
