const SINGLE_TWEET_STYLE_LIMIT = 500;
const SINGLE_TWEET_TOPIC_LIMIT = 280;

function compactSingleTweetPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatSingleTweetStyleForPrompt(style: string): string {
  return compactSingleTweetPromptText(style, SINGLE_TWEET_STYLE_LIMIT);
}

export function formatSingleTweetTopicForPrompt(topic: string): string {
  return compactSingleTweetPromptText(topic, SINGLE_TWEET_TOPIC_LIMIT);
}

export function getSingleTweetFallbackMaxTokens(topicLength: number): number {
  if (topicLength <= 120) return 512;
  if (topicLength <= 500) return 768;
  return 1024;
}
