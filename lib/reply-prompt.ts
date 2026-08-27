import type { PersonalizationMemory } from './types';
import { PERSONALIZATION_MEMORY_PROMPT_HEADER, buildPersonalizationMemoryPrompt } from './personalization-memory-prompt';

const REPLY_PARENT_CONTEXT_LIMIT = 1500;
const REPLY_TARGET_TEXT_LIMIT = 1000;
const REPLY_CONVERSATION_TURN_LIMIT = 6;
const REPLY_CONVERSATION_TURN_TEXT_LIMIT = 500;
const REPLY_SOUL_CONTEXT_LIMIT = 2200;
const REPLY_REFERENCE_TWEET_LIMIT = 4;
const REPLY_REFERENCE_TWEET_TEXT_LIMIT = 180;

export type ReplyConversationTurn = {
  role: 'us' | 'them';
  author: string;
  content: string;
};

export type ReplyReferenceTweet = {
  likes: number;
  text: string;
};

export function compactPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatReplyTargetTextForPrompt(text: string): string {
  return compactPromptText(text, REPLY_TARGET_TEXT_LIMIT);
}

export function formatReplyParentContextForPrompt(context: string | null): string | null {
  if (!context?.trim()) return null;
  return compactPromptText(context, REPLY_PARENT_CONTEXT_LIMIT);
}

export function formatReplyConversationHistoryForPrompt(
  conversationHistory: ReplyConversationTurn[],
  agentHandle: string,
): string[] {
  const recentTurns = conversationHistory.slice(-REPLY_CONVERSATION_TURN_LIMIT);
  return recentTurns.map((turn) => {
    const label = turn.role === 'us' ? `YOU (@${agentHandle})` : turn.author;
    return `${label}: "${compactPromptText(turn.content, REPLY_CONVERSATION_TURN_TEXT_LIMIT)}"`;
  });
}

export function formatReplySoulForPrompt(soulMd: string | null | undefined): string {
  if (!soulMd?.trim()) return '';
  return compactPromptText(soulMd, REPLY_SOUL_CONTEXT_LIMIT);
}

export function formatReplyMemoryForPrompt(memory: PersonalizationMemory | null | undefined): string {
  const prompt = buildPersonalizationMemoryPrompt(memory);
  return prompt ? `${PERSONALIZATION_MEMORY_PROMPT_HEADER}\n${prompt}` : '';
}

export function formatReplyReferenceTweetsForPrompt(tweets: ReplyReferenceTweet[]): string {
  return tweets
    .slice(0, REPLY_REFERENCE_TWEET_LIMIT)
    .map((tweet) => `- [${tweet.likes} likes] "${compactPromptText(tweet.text, REPLY_REFERENCE_TWEET_TEXT_LIMIT)}"`)
    .join('\n');
}

export function getAutoReplyMaxTokens(options: {
  highValueMode?: boolean;
  hasParentContext?: boolean;
  conversationTurns?: number;
}): number {
  if (options.highValueMode || options.hasParentContext || (options.conversationTurns || 0) > 0) {
    return 768;
  }
  return 384;
}
