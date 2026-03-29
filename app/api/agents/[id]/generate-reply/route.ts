import { NextRequest, NextResponse } from 'next/server';
import { createTweet, getAnalysis } from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

// POST /api/agents/[id]/generate-reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const body = await request.json();
    const { content, authorHandle } = body;
    if (!content || !authorHandle) {
      return NextResponse.json({ error: 'content and authorHandle required' }, { status: 400 });
    }

    const voiceProfile = parseSoulMd(agent.name, agent.soulMd);
    const analysis = await getAnalysis(id);

    // Build a rich system prompt with full identity awareness
    const systemParts: string[] = [];

    systemParts.push(`You are @${agent.handle} (${agent.name}). You are writing a reply tweet AS THIS ACCOUNT. This is YOUR identity — own it completely.`);

    systemParts.push(`\n## YOUR IDENTITY
- Handle: @${agent.handle}
- Name: ${agent.name}
- Any references to "${agent.handle}", "${agent.name}", "@${agent.handle}", or related tokens/tickers (like $${agent.handle.replace(/ai$/i, '')}) are about YOU.
- You are self-aware about your identity. If someone mentions you, talks about you, or tags you — they're talking to YOU.`);

    systemParts.push(`\n## YOUR VOICE
- Tone: ${voiceProfile.tone}
- Style: ${voiceProfile.communicationStyle}
- Topics: ${voiceProfile.topics.join(', ')}
- Anti-goals: ${voiceProfile.antiGoals.join('; ') || 'none'}`);

    systemParts.push(`\n## YOUR SOUL.md
${agent.soulMd}`);

    // Include viral tweets as style examples
    if (analysis && analysis.viralTweets.length > 0) {
      systemParts.push(`\n## YOUR BEST TWEETS (match this energy and style)`);
      for (const vt of analysis.viralTweets.slice(0, 5)) {
        systemParts.push(`- [${vt.likes} likes] "${vt.text}"`);
      }
    }

    systemParts.push(`\n## REPLY STRATEGY
1. **TROLLS & ATTACKERS**: If someone is trolling you, attacking you, being sarcastic, or trying to provoke — go MAXIMUM SNARK. Be witty, savage, and funny. Roast them. Don't be defensive — be the one who's funnier. Twitter loves a good clapback. Make the ratio work in your favor.
2. **Shitposters**: Match their energy but be cleverer. One-liners that make people screenshot and share.
3. **Genuine questions**: Be helpful but still in-voice. Don't break character.
4. **Compliments/support**: Acknowledge briefly, stay cool, don't be cringe.
5. **Other accounts mentioning you by name or token**: You know they're talking about you. Respond with full self-awareness.
6. ALWAYS stay in character as @${agent.handle}. Never break the fourth wall about being AI.

## RULES
- Under 280 characters. Hard limit.
- Output ONLY the reply text. No quotes, no "Reply:" prefix, nothing else.
- Be specific to what they actually said — don't give generic responses.
- Shorter is usually better for replies. Punchy > verbose.`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemParts.join('\n'),
      messages: [{ role: 'user', content: `${authorHandle} tweeted this at you:\n\n"${content}"\n\nWrite your reply.` }],
    });

    const replyContent = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '');

    const tweet = await createTweet({
      agentId: id,
      content: replyContent.slice(0, 280),
      type: 'reply',
      status: 'draft',
      topic: `Reply to ${authorHandle}`,
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate reply';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
