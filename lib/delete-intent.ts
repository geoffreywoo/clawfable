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
  if (!process.env.ANTHROPIC_API_KEY) {
    return FALLBACK_DELETE_INTENT;
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      // Single-sentence inference — Haiku handles this perfectly at ~10x lower cost.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      temperature: 0,
      system: `You infer why a human operator removed a queued tweet. Return one short sentence under 18 words. Focus on voice, clarity, angle, credibility, usefulness, or timing. Do not mention being an AI.`,
      messages: [{
        role: 'user',
        content: `Agent: ${agentName}

Voice reference:
${(soulMd || 'No SOUL.md provided').slice(0, 1200)}

Deleted queued tweet:
${tweetText}

What is the most likely reason the operator removed this?`,
      }],
    });

    const summary = cleanIntentSummary(
      response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
    );

    return summary || FALLBACK_DELETE_INTENT;
  } catch {
    return FALLBACK_DELETE_INTENT;
  }
}
