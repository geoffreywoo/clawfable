import { generateText, hasTextGenerationProvider } from './ai';

interface InferDeleteIntentInput {
  agentName: string;
  soulMd: string | null;
  tweetText: string;
}

const FALLBACK_DELETE_INTENT = 'Likely off-voice, low-conviction, unclear, or not useful enough to keep in queue.';
const DELETE_INTENT_SOUL_LIMIT = 600;
const DELETE_INTENT_TWEET_LIMIT = 700;

function compactDeleteIntentPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatDeleteIntentSoulForPrompt(soulMd: string | null): string {
  if (!soulMd?.trim()) return 'No SOUL.md provided';
  return compactDeleteIntentPromptText(soulMd, DELETE_INTENT_SOUL_LIMIT);
}

export function formatDeleteIntentTweetForPrompt(tweetText: string): string {
  return compactDeleteIntentPromptText(tweetText, DELETE_INTENT_TWEET_LIMIT);
}

function cleanIntentSummary(text: string): string {
  return text
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function inferDeleteIntent({
  agentName,
  soulMd,
  tweetText,
}: InferDeleteIntentInput): Promise<string> {
  if (!hasTextGenerationProvider()) {
    return FALLBACK_DELETE_INTENT;
  }

  try {
    const response = await generateText({
      task: 'classification',
      tier: 'fast',
      maxTokens: 48,
      temperature: 0,
      system: `You infer why a human operator removed a queued tweet. Return one short sentence under 18 words. Focus on voice, clarity, angle, credibility, usefulness, or timing. Do not mention being an AI.`,
      prompt: `Agent: ${agentName}

Voice reference:
${formatDeleteIntentSoulForPrompt(soulMd)}

Deleted queued tweet:
${formatDeleteIntentTweetForPrompt(tweetText)}

What is the most likely reason the operator removed this?`,
    });

    const summary = cleanIntentSummary(response.text);

    return summary || FALLBACK_DELETE_INTENT;
  } catch {
    return FALLBACK_DELETE_INTENT;
  }
}
