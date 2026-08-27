import { describe, expect, it } from 'vitest';
import type { VoiceDirective, VoiceDirectiveRule } from '@/lib/types';
import {
  formatDirectiveAuditTweetList,
  formatVoiceChatMessagesForPrompt,
  formatVoiceChatSoulForPrompt,
  formatVoiceDirectiveRulesForPrompt,
  getDirectiveAuditMaxTokens,
  getVoiceChatResponseMaxTokens,
} from '@/lib/voice-chat-prompt';

function directiveRule(index: number, rawDirective = `Lead with concrete evidence ${index}.`): VoiceDirectiveRule {
  return {
    id: `rule-${index}`,
    rawDirective,
    normalizedRule: `${rawDirective} ${'extra context '.repeat(40)}DIRECTIVE_SENTINEL_${index}`,
    systemLesson: rawDirective,
    scope: {
      type: 'general',
      operator: 'prefer',
      target: null,
    },
    sourceMessage: null,
    supersedesRuleIds: [],
    supersededByRuleId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
  };
}

describe('voice chat prompt budgeting', () => {
  it('compacts SOUL and chat history while preserving recent context', () => {
    const soul = formatVoiceChatSoulForPrompt(`identity ${'voice detail '.repeat(200)}SOUL_SENTINEL`);
    const chat: VoiceDirective[] = Array.from({ length: 8 }, (_, index) => ({
      id: `message-${index + 1}`,
      role: index % 2 === 0 ? 'operator' : 'agent',
      content: `message ${index + 1} ${'chat detail '.repeat(80)}CHAT_SENTINEL_${index + 1}`,
      ts: new Date().toISOString(),
    }));

    const messages = formatVoiceChatMessagesForPrompt(chat, `current ${'operator note '.repeat(120)}CURRENT_SENTINEL`);

    expect(soul.length).toBeLessThan(1550);
    expect(soul).not.toContain('SOUL_SENTINEL');
    expect(messages).toHaveLength(7);
    expect(messages[0].content).toContain('message 3');
    expect(messages.map((message) => message.content).join('\n')).not.toContain('message 1');
    expect(messages.map((message) => message.content).join('\n')).not.toContain('CHAT_SENTINEL_8');
    expect(messages.at(-1)?.content).not.toContain('CURRENT_SENTINEL');
    expect(messages.every((message) => message.content.length <= 1000)).toBe(true);
  });

  it('limits directive rules and queue audit text without changing indexes', () => {
    const directives = formatVoiceDirectiveRulesForPrompt(Array.from({ length: 10 }, (_, index) => directiveRule(index + 1)));
    const queuedTweets = Array.from({ length: 3 }, (_, index) => ({
      content: `queued ${index + 1} ${'tweet context '.repeat(50)}QUEUE_SENTINEL_${index + 1}`,
    }));
    const tweetList = formatDirectiveAuditTweetList(queuedTweets);

    expect(directives).toContain('Lead with concrete evidence 1');
    expect(directives).toContain('2 lower-priority directives omitted');
    expect(directives).not.toContain('DIRECTIVE_SENTINEL_1');
    expect(tweetList).toContain('[0]');
    expect(tweetList).toContain('[2]');
    expect(tweetList).not.toContain('QUEUE_SENTINEL_1');
  });

  it('scales directive audit output budget with queue size', () => {
    expect(getDirectiveAuditMaxTokens(1)).toBe(768);
    expect(getDirectiveAuditMaxTokens(8)).toBe(1280);
    expect(getDirectiveAuditMaxTokens(20)).toBe(2048);
    expect(getDirectiveAuditMaxTokens(21)).toBe(3072);
  });

  it('scales coaching response budget by message and directive complexity', () => {
    expect(getVoiceChatResponseMaxTokens({ messageLength: 120, directiveCount: 2 })).toBe(384);
    expect(getVoiceChatResponseMaxTokens({ messageLength: 900, directiveCount: 2 })).toBe(512);
    expect(getVoiceChatResponseMaxTokens({ messageLength: 120, directiveCount: 7 })).toBe(512);
  });
});
