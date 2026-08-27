const MARKETING_VOICE_STYLE_LIMIT = 400;
const MARKETING_RECENT_POST_LIMIT = 5;
const MARKETING_RECENT_POST_TEXT_LIMIT = 120;
const SHOUTOUT_SOUL_SUMMARY_LIMIT = 220;

function compactPromotionPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatMarketingVoiceStyleForPrompt(style: string): string {
  return compactPromotionPromptText(style, MARKETING_VOICE_STYLE_LIMIT);
}

export function formatMarketingRecentPostsForPrompt(recentPosts: string[]): string {
  return recentPosts
    .slice(0, MARKETING_RECENT_POST_LIMIT)
    .map((post) => `- "${compactPromotionPromptText(post, MARKETING_RECENT_POST_TEXT_LIMIT)}"`)
    .join('\n');
}

export function getMarketingTweetMaxTokens(count: number): number {
  if (count <= 1) return 768;
  if (count === 2) return 1024;
  return 1536;
}

export function formatShoutoutSoulSummaryForPrompt(summary: string | null | undefined, fallbackName: string): string {
  return compactPromotionPromptText(summary?.trim() || fallbackName, SHOUTOUT_SOUL_SUMMARY_LIMIT);
}

export function getShoutoutMaxTokens(): number {
  return 128;
}
