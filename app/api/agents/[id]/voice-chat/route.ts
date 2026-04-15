import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getVoiceChat, addVoiceChatMessage, addVoiceDirective, getVoiceDirectives, getVoiceDirectiveRules, getQueuedTweets, updateTweet, deleteTweet } from '@/lib/kv-storage';
import type { VoiceDirective, VoiceDirectiveRule } from '@/lib/types';
import { generateText } from '@/lib/ai';
import { formatVoiceDirectiveRule, getActiveVoiceDirectiveRules } from '@/lib/voice-directives';

// GET /api/agents/[id]/voice-chat — get chat history + active directives
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const [chat, directives, directiveRules] = await Promise.all([
      getVoiceChat(id, 30),
      getVoiceDirectives(id),
      getVoiceDirectiveRules(id),
    ]);
    return NextResponse.json({
      chat,
      directives,
      directiveRules: getActiveVoiceDirectiveRules(directiveRules),
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch voice chat' }, { status: 500 });
  }
}

// POST /api/agents/[id]/voice-chat — send a message to the agent's voice
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const body = await request.json();
    const { message } = body;
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }

    // Store operator message
    const operatorMsg: VoiceDirective = {
      id: `op-${Date.now()}`,
      role: 'operator',
      content: message.trim(),
      ts: new Date().toISOString(),
    };
    await addVoiceChatMessage(id, operatorMsg);

    // Get existing directives and chat history for context
    const [existingDirectiveRules, chatHistory] = await Promise.all([
      getVoiceDirectiveRules(id),
      getVoiceChat(id, 10),
    ]);
    const activeDirectiveRules = getActiveVoiceDirectiveRules(existingDirectiveRules);

    // The model responds AS the agent, acknowledges the feedback, and extracts a directive
    const response = await generateText({
      tier: 'quality',
      maxTokens: 512,
      system: `You are @${agent.handle} (${agent.name}), an AI agent having a voice coaching session with your operator.

YOUR SOUL.md:
${(agent.soulMd || '').slice(0, 1500)}

EXISTING STANDING DIRECTIVES (already locked in):
${activeDirectiveRules.length > 0 ? activeDirectiveRules.map((rule, i) => formatVoiceDirectiveRule(rule, i)).join('\n') : 'None yet'}

The operator is giving you feedback about your voice, style, or content. Your job:
1. Respond in your agent voice (stay in character, be brief, 1-3 sentences)
2. Acknowledge what they want changed
3. After your response, output a line starting with "DIRECTIVE:" containing ONE specific, actionable rule that should permanently change how you write tweets. This rule will be stored and applied to ALL future tweet generation.

Examples of good directives:
- "DIRECTIVE: Never use the word 'democratizing' — it sounds corporate"
- "DIRECTIVE: Open 30% of tweets with a specific number or data point"
- "DIRECTIVE: When discussing crypto, always reference on-chain data, never price speculation"
- "DIRECTIVE: Keep tweets under 180 characters unless it's a deep analysis post"

If the operator is just chatting (not giving voice feedback), respond naturally and output "DIRECTIVE: none"`,
      messages: chatHistory.slice(-6).map((m) => ({
        role: m.role === 'operator' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })).concat([{ role: 'user' as const, content: message.trim() }]),
    });

    const responseText = response.text;

    // Extract directive
    const directiveMatch = responseText.match(/DIRECTIVE:\s*(.+)/i);
    let agentReply = responseText;
    let extractedDirective: string | null = null;
    let savedRule: VoiceDirectiveRule | null = null;

    if (directiveMatch) {
      const directive = directiveMatch[1].trim();
      agentReply = responseText.slice(0, directiveMatch.index).trim();
      if (directive.toLowerCase() !== 'none' && directive.length > 5) {
        savedRule = await addVoiceDirective(id, directive, {
          sourceMessage: message.trim(),
        });
        extractedDirective = savedRule.rawDirective;
      }
    }

    // Store agent response
    const agentMsg: VoiceDirective = {
      id: `agent-${Date.now()}`,
      role: 'agent',
      content: agentReply,
      directive: extractedDirective || undefined,
      ts: new Date().toISOString(),
    };
    await addVoiceChatMessage(id, agentMsg);

    // If a new directive was locked in, audit the queue for stale tweets that violate it
    let queueAudit: { purged: number; rewritten: number } = { purged: 0, rewritten: 0 };
    if (extractedDirective) {
      try {
        queueAudit = await auditQueueAgainstDirective(id, agent, extractedDirective);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      reply: agentReply + (queueAudit.purged > 0 || queueAudit.rewritten > 0
        ? `\n\n(Audited queue: ${queueAudit.rewritten} tweets rewritten, ${queueAudit.purged} removed)`
        : ''),
      directive: extractedDirective,
      directiveRule: savedRule,
      directives: await getVoiceDirectives(id),
      directiveRules: getActiveVoiceDirectiveRules(await getVoiceDirectiveRules(id)),
      queueAudit,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Voice chat failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Audit all queued tweets against a new directive.
 * Tweets that violate the directive get rewritten in-place.
 * Tweets that can't be salvaged get purged.
 */
async function auditQueueAgainstDirective(
  agentId: string,
  agent: { name: string; handle: string; soulMd: string },
  directive: string,
): Promise<{ purged: number; rewritten: number }> {
  const queue = await getQueuedTweets(agentId);
  if (queue.length === 0) return { purged: 0, rewritten: 0 };

  // Send all queued tweets to the model for audit
  const tweetList = queue.map((t, i) => `[${i}] "${t.content.slice(0, 250)}"`).join('\n');

  const response = await generateText({
    tier: 'quality',
    maxTokens: 2048,
    system: `You audit queued tweets against a new voice directive. For each tweet, decide:
- PASS: tweet already complies with the directive
- REWRITE: tweet violates the directive but can be fixed. Output the rewritten version.
- PURGE: tweet fundamentally conflicts and should be removed

Output one JSON line per tweet: {"idx": N, "action": "pass|rewrite|purge", "rewritten": "new text if rewrite"}
Only output JSON lines, no other text.

Voice: @${agent.handle} (${agent.name})`,
    prompt: `NEW DIRECTIVE: ${directive}

QUEUED TWEETS TO AUDIT:
${tweetList}

Audit each tweet against the directive. Be strict — if it violates the spirit of the directive, rewrite or purge it.`,
  });

  const text = response.text;

  let purged = 0;
  let rewritten = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const idx = parsed.idx;
      if (typeof idx !== 'number' || idx < 0 || idx >= queue.length) continue;
      const tweet = queue[idx];

      if (parsed.action === 'rewrite' && parsed.rewritten) {
        const cleanRewritten = parsed.rewritten
          .replace(/^["']|["']$/g, '')
          .replace(/\s*https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\S*/gi, '')
          .trim();
        if (cleanRewritten.length > 10) {
          await updateTweet(tweet.id, { content: cleanRewritten });
          rewritten++;
        }
      } else if (parsed.action === 'purge') {
        await deleteTweet(tweet.id);
        purged++;
      }
    } catch { /* skip malformed */ }
  }

  return { purged, rewritten };
}
