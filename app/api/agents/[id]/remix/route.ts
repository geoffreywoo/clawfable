import { NextRequest, NextResponse } from 'next/server';
import { updateTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const REMIX_DIRECTIONS: Record<string, string> = {
  shorter: 'Make it shorter and punchier. Cut the fat. Under 200 chars if possible.',
  longer: 'Expand into a longer, more detailed post. Add analysis, context, or a structured breakdown. 500-1500 chars. Use line breaks.',
  spicier: 'Make it more provocative, controversial, and attention-grabbing. Sharper edge. More snark.',
  softer: 'Make it less aggressive. More thoughtful and nuanced. Keep the point but dial down the heat.',
  funnier: 'Make it funnier. Add wit, irony, or absurdist humor. Should make people laugh or screenshot.',
  data: 'Reframe around data, numbers, or specific evidence. Add a stat, percentage, or concrete example.',
  question: 'Reframe as a provocative question that sparks replies and debate.',
  contrarian: 'Flip the take. Argue the opposite angle with conviction.',
};

// POST /api/agents/[id]/remix — remix a tweet in a direction
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const body = await request.json();
    const { tweetId, content, direction, customPrompt } = body;
    if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });

    // Build the remix instruction
    let instruction: string;
    if (customPrompt) {
      instruction = customPrompt;
    } else if (direction && REMIX_DIRECTIONS[direction]) {
      instruction = REMIX_DIRECTIONS[direction];
    } else {
      return NextResponse.json({ error: 'direction or customPrompt required' }, { status: 400 });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You remix tweets. Keep the same core voice and identity but transform the tweet based on the instruction. Output ONLY the new tweet text — no quotes, no commentary, no "Here's the remix:" prefix.${agent.soulMd ? `\n\nVoice reference:\n${agent.soulMd.slice(0, 1000)}` : ''}`,
      messages: [{ role: 'user', content: `Original tweet:\n"${content}"\n\nInstruction: ${instruction}` }],
    });

    const remixed = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '');

    // If tweetId provided, update the tweet in place
    if (tweetId) {
      await updateTweet(String(tweetId), { content: remixed });
    }

    return NextResponse.json({ content: remixed, direction: direction || 'custom' });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Remix failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
