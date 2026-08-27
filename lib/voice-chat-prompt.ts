import type { Tweet, VoiceDirective, VoiceDirectiveRule } from './types';
import { formatVoiceDirectiveRule } from './voice-directives';

const VOICE_CHAT_SOUL_LIMIT = 1500;
const VOICE_CHAT_MESSAGE_LIMIT = 500;
const VOICE_CHAT_CURRENT_MESSAGE_LIMIT = 1000;
const VOICE_CHAT_HISTORY_LIMIT = 6;
const VOICE_CHAT_DIRECTIVE_RULE_LIMIT = 8;
const VOICE_DIRECTIVE_RULE_TEXT_LIMIT = 320;
const DIRECTIVE_AUDIT_TWEET_TEXT_LIMIT = 200;

export function compactVoicePromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatVoiceChatSoulForPrompt(soulMd: string | null | undefined): string {
  if (!soulMd?.trim()) return '';
  return compactVoicePromptText(soulMd, VOICE_CHAT_SOUL_LIMIT);
}

export function formatVoiceDirectiveRulesForPrompt(rules: VoiceDirectiveRule[]): string {
  const activeRules = rules.slice(0, VOICE_CHAT_DIRECTIVE_RULE_LIMIT);
  if (activeRules.length === 0) return 'None yet';

  const lines = activeRules.map((rule, index) =>
    compactVoicePromptText(formatVoiceDirectiveRule(rule, index), VOICE_DIRECTIVE_RULE_TEXT_LIMIT)
  );
  const omitted = rules.length - activeRules.length;
  if (omitted > 0) {
    lines.push(`${omitted} lower-priority directives omitted from this coaching prompt; saved directive rules still apply in generation.`);
  }
  return lines.join('\n');
}

export function formatVoiceChatMessagesForPrompt(
  chatHistory: VoiceDirective[],
  currentMessage: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return chatHistory.slice(-VOICE_CHAT_HISTORY_LIMIT).map((message) => ({
    role: message.role === 'operator' ? 'user' as const : 'assistant' as const,
    content: compactVoicePromptText(message.content, VOICE_CHAT_MESSAGE_LIMIT),
  })).concat([{
    role: 'user' as const,
    content: compactVoicePromptText(currentMessage, VOICE_CHAT_CURRENT_MESSAGE_LIMIT),
  }]);
}

export function formatDirectiveAuditTweetList(tweets: Array<Pick<Tweet, 'content'>>): string {
  return tweets
    .map((tweet, index) => `[${index}] "${compactVoicePromptText(tweet.content, DIRECTIVE_AUDIT_TWEET_TEXT_LIMIT)}"`)
    .join('\n');
}

export function getDirectiveAuditMaxTokens(tweetCount: number): number {
  if (tweetCount <= 5) return 768;
  if (tweetCount <= 10) return 1280;
  if (tweetCount <= 20) return 2048;
  return 3072;
}

export function getVoiceChatResponseMaxTokens(options: { messageLength: number; directiveCount: number }): number {
  if (options.messageLength > 700 || options.directiveCount > 6) return 512;
  return 384;
}
