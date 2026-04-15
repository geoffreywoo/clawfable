import { generateText, hasTextGenerationProvider } from './ai';

interface InferDeleteIntentInput {
  agentName: string;
  soulMd: string | null;
  tweetText: string;
}

const FALLBACK_DELETE_INTENT = 'Likely off-voice, low-conviction, unclear, or not useful enough to keep in queue.';

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
      tier: 'fast',
      maxTokens: 80,
      temperature: 0,
      system: `You infer why a human operator removed a queued tweet. Return one short sentence under 18 words. Focus on voice, clarity, angle, credibility, usefulness, or timing. Do not mention being an AI.`,
      prompt: `Agent: ${agentName}

Voice reference:
${(soulMd || 'No SOUL.md provided').slice(0, 1200)}

Deleted queued tweet:
${tweetText}

What is the most likely reason the operator removed this?`,
    });

    const summary = cleanIntentSummary(response.text);

    return summary || FALLBACK_DELETE_INTENT;
  } catch {
    return FALLBACK_DELETE_INTENT;
  }
}
