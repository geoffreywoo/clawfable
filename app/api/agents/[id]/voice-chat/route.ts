import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getVoiceChat, addVoiceChatMessage, addVoiceDirective, getVoiceDirectives, getVoiceDirectiveRules, getQueuedTweets, updateTweet } from '@/lib/kv-storage';
import type { VoiceDirective, VoiceDirectiveRule } from '@/lib/types';
import { generateText } from '@/lib/ai';
import { getActiveVoiceDirectiveRules } from '@/lib/voice-directives';
import {
  formatDirectiveAuditTweetList,
  formatVoiceChatMessagesForPrompt,
  formatVoiceChatSoulForPrompt,
  formatVoiceDirectiveRulesForPrompt,
  getDirectiveAuditMaxTokens,
  getVoiceChatResponseMaxTokens,
} from '@/lib/voice-chat-prompt';
import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';
import { readJsonObjectBody } from '@/lib/request-validation';

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
    const { agent, user } = await requireAgentAccess(id);
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
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
      task: 'learning',
      maxTokens: getVoiceChatResponseMaxTokens({
        messageLength: message.trim().length,
        directiveCount: activeDirectiveRules.length,
      }),
      system: `You are @${agent.handle} (${agent.name}), an AI agent having a voice coaching session with your operator.

YOUR SOUL.md:
${formatVoiceChatSoulForPrompt(agent.soulMd)}

EXISTING STANDING DIRECTIVES (already locked in):
${formatVoiceDirectiveRulesForPrompt(activeDirectiveRules)}

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
      messages: formatVoiceChatMessagesForPrompt(chatHistory, message.trim()),
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
    let queueAudit: { quarantined: number } = { quarantined: 0 };
    if (extractedDirective && (await getAgentAutomationEntitlement(id, { agent, user })).eligible) {
      try {
        queueAudit = await auditQueueAgainstDirective(id, agent, extractedDirective);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      reply: agentReply + (queueAudit.quarantined > 0
        ? `\n\n(Audited queue: ${queueAudit.quarantined} conflicting drafts quarantined for review)`
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
 * Audit queued tweets against a new directive without mutating generated copy.
 * Conflicts are quarantined so any replacement must go through a new V2 run.
 */
async function auditQueueAgainstDirective(
  agentId: string,
  agent: { name: string; handle: string; soulMd: string },
  directive: string,
): Promise<{ quarantined: number }> {
  const queue = await getQueuedTweets(agentId);
  if (queue.length === 0) return { quarantined: 0 };

  const tweetList = formatDirectiveAuditTweetList(queue);

  const response = await generateText({
    task: 'final_judgment',
    maxTokens: getDirectiveAuditMaxTokens(queue.length),
    system: `You audit queued tweets against a new voice directive. For each tweet, decide:
- PASS: tweet already complies with the directive
- QUARANTINE: tweet conflicts with the directive and requires a newly qualified draft

Output one JSON line per tweet: {"idx": N, "action": "pass|quarantine"}
Only output JSON lines, no other text.

Voice: @${agent.handle} (${agent.name})`,
    prompt: `NEW DIRECTIVE: ${directive}

QUEUED TWEETS TO AUDIT:
${tweetList}

Audit each tweet against the directive. Be strict: quarantine anything that violates its spirit.`,
  });

  const text = response.text;

  let quarantined = 0;
  const quarantinedAt = new Date().toISOString();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const idx = parsed.idx;
      if (typeof idx !== 'number' || idx < 0 || idx >= queue.length) continue;
      const tweet = queue[idx];

      if (parsed.action === 'quarantine') {
        await updateTweet(tweet.id, {
          status: 'quarantined',
          scheduledAt: null,
          quarantinedAt,
          quarantineReason: `Conflicts with voice directive: ${directive}`,
          preQuarantineStatus: tweet.status === 'quarantined' ? null : tweet.status,
        });
        quarantined++;
      }
    } catch { /* skip malformed */ }
  }

  return { quarantined };
}
