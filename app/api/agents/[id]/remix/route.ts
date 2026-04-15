import { NextRequest, NextResponse } from 'next/server';
import { updateTweet, addRemixEntry } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getGeneratedTweetIssue } from '@/lib/survivability';
import { generateText } from '@/lib/ai';

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

    let remixed = '';
    let lastIssue: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await generateText({
        tier: 'quality',
        maxTokens: attempt === 0 ? 1024 : 1536,
        system: `You remix tweets. Keep the same core voice and identity but transform the tweet based on the instruction. Output ONLY the new tweet text — no quotes, no commentary, no "Here's the remix:" prefix.${agent.soulMd ? `\n\nVoice reference:\n${agent.soulMd.slice(0, 1000)}` : ''}`,
        prompt: `Original tweet:\n"${content}"\n\nInstruction: ${instruction}`,
      });

      remixed = response.text
        .trim()
        .replace(/^["']|["']$/g, '');

      lastIssue = getGeneratedTweetIssue(remixed, response.stopReason);
      if (!lastIssue) break;
    }

    if (lastIssue) {
      return NextResponse.json({ error: lastIssue }, { status: 502 });
    }

    // If tweetId provided, update the tweet in place
    if (tweetId) {
      await updateTweet(String(tweetId), { content: remixed });
    }

    // Store remix direction in memory for future generation learning
    await addRemixEntry(id, {
      direction: direction || 'custom',
      customPrompt: customPrompt || undefined,
      originalContent: content,
      remixedContent: remixed,
      ts: new Date().toISOString(),
    });

    return NextResponse.json({ content: remixed, direction: direction || 'custom' });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Remix failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
