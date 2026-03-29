import { NextRequest, NextResponse } from 'next/server';
import { createTweet } from '@/lib/kv-storage';
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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `You are a tweet reply ghostwriter. Voice: ${voiceProfile.tone}. Style: ${voiceProfile.communicationStyle}. Topics: ${voiceProfile.topics.join(', ')}. Anti-goals: ${voiceProfile.antiGoals.join('; ') || 'none'}.\n\nWrite a single reply tweet. Under 280 characters. Be specific, opinionated, and add value — don't just agree. Match the account's voice exactly.`,
      messages: [{ role: 'user', content: `Write a reply to this tweet by ${authorHandle}:\n\n"${content}"\n\nOutput ONLY the reply text, nothing else.` }],
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
    return NextResponse.json({ error: 'Failed to generate reply' }, { status: 500 });
  }
}
