import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/ai';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { buildEngagementDraft } from '@/lib/engagement';
import { getAnalysis, createTweet, addLearningSignal } from '@/lib/kv-storage';
import type { EngagementCandidate } from '@/lib/types';
import { getPlatformGoalForHandle } from '@/lib/platform-goal';
import { scoreHighValueReply } from '@/lib/virality-signals';

function validCandidate(candidate: Partial<EngagementCandidate> | null | undefined, agentId: string): candidate is EngagementCandidate {
  return !!candidate
    && typeof candidate.tweetId === 'string'
    && typeof candidate.tweetUrl === 'string'
    && typeof candidate.authorHandle === 'string'
    && typeof candidate.text === 'string'
    && typeof candidate.createdAt === 'string'
    && String(candidate.agentId) === String(agentId);
}

// POST /api/agents/[id]/engage/draft-reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { agent } = await requireAgentAccess(id);
    const body = await request.json();
    const candidate = body?.candidate as Partial<EngagementCandidate> | undefined;

    if (!validCandidate(candidate, id)) {
      return NextResponse.json({ error: 'candidate is required' }, { status: 400 });
    }

    const [{ voiceProfile, memory }, analysis] = await Promise.all([
      buildGenerationContext(agent, {
        negativeLimit: 6,
        directiveLimit: 10,
      }),
      getAnalysis(id),
    ]);
    const valueScore = scoreHighValueReply({
      text: candidate.text,
      authorUsername: candidate.authorHandle.replace(/^@/, ''),
      authorName: candidate.authorName,
      createdAt: candidate.createdAt,
    }, { topics: voiceProfile.topics });

    const systemParts: string[] = [];
    systemParts.push(`You are @${agent.handle} (${agent.name}). Write a reply to another account on X in this account's voice.`);
    systemParts.push(`\n## CLAWFABLE PLATFORM GOAL (NON-NEGOTIABLE)
${getPlatformGoalForHandle(agent.handle)}

Preserve the account's authentic voice while increasing the odds of niche attention, conversation, and virality.`);
    systemParts.push(`\n## VOICE CONTRACT
- Tone: ${voiceProfile.tone}
- Style: ${voiceProfile.communicationStyle}
- Topics: ${voiceProfile.topics.join(', ') || 'the agent voice topics'}
- Anti-goals: ${voiceProfile.antiGoals.join('; ') || 'none'}`);

    if (memory.alwaysDoMoreOfThis.length > 0) {
      systemParts.push(`\n## REINFORCED PATTERNS\n${memory.alwaysDoMoreOfThis.map((item) => `- ${item}`).join('\n')}`);
    }
    if (memory.neverDoThisAgain.length > 0) {
      systemParts.push(`\n## AVOID\n${memory.neverDoThisAgain.map((item) => `- ${item}`).join('\n')}`);
    }

    systemParts.push(`\n## SOUL.md\n${agent.soulMd.slice(0, 2200)}`);

    if (analysis?.viralTweets?.length) {
      systemParts.push('\n## STRONG REFERENCE TWEETS');
      for (const tweet of analysis.viralTweets.slice(0, 4)) {
        systemParts.push(`- [${tweet.likes} likes] "${tweet.text}"`);
      }
    }

    systemParts.push(`\n## ENGAGE REPLY RULES
- Reply to the specific tweet, not a generic topic.
- Add a point, angle, example, or disagreement. Avoid empty applause.
- Treat this as high-value reply drafting: value score ${valueScore.score} (${valueScore.reason}); strategy ${valueScore.responseStrategy.replace(/_/g, ' ')}.
- Keep it concise and screenshotable unless the argument needs more room.
- Do not mention being an AI, assistant, or prompt.
- Output only the reply text.`);

    const response = await generateText({
      task: 'reply_generation',
      tier: 'quality',
      maxTokens: 260,
      system: systemParts.join('\n'),
      prompt: `Target tweet from @${candidate.authorHandle}:\n\n"${candidate.text}"\n\nWrite the best reply for @${agent.handle}.`,
    });

    const content = response.text.trim().replace(/^["']|["']$/g, '');
    if (!content) {
      return NextResponse.json({ error: 'Failed to generate a reply draft' }, { status: 500 });
    }

    const tweet = await createTweet({
      agentId: id,
      content,
      type: 'reply',
      status: 'draft',
      topic: `Engage reply to @${candidate.authorHandle}`,
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: candidate.authorHandle,
      scheduledAt: null,
    });

    await addLearningSignal(id, {
      tweetId: tweet.id,
      xTweetId: candidate.tweetId,
      signalType: 'reply_generated',
      surface: 'engage',
      rewardDelta: 0.1,
      metadata: {
        targetHandle: candidate.authorHandle,
        targetTweetId: candidate.tweetId,
        candidateScore: candidate.score,
        replyValueScore: valueScore.score,
        responseStrategy: valueScore.responseStrategy,
      },
    });

    return NextResponse.json({
      tweet,
      draft: buildEngagementDraft(tweet),
      candidate,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate engage reply';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
