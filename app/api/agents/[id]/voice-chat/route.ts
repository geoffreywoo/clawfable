import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getVoiceChat, addVoiceChatMessage, addVoiceDirective, getVoiceDirectives } from '@/lib/kv-storage';
import type { VoiceDirective } from '@/lib/types';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

// GET /api/agents/[id]/voice-chat — get chat history + active directives
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const [chat, directives] = await Promise.all([
      getVoiceChat(id, 30),
      getVoiceDirectives(id),
    ]);
    return NextResponse.json({ chat, directives });
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
    const [existingDirectives, chatHistory] = await Promise.all([
      getVoiceDirectives(id),
      getVoiceChat(id, 10),
    ]);

    // Claude responds AS the agent, acknowledges the feedback, and extracts a directive
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: `You are @${agent.handle} (${agent.name}), an AI agent having a voice coaching session with your operator.

YOUR SOUL.md:
${(agent.soulMd || '').slice(0, 1500)}

EXISTING STANDING DIRECTIVES (already locked in):
${existingDirectives.length > 0 ? existingDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n') : 'None yet'}

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

    const responseText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Extract directive
    const directiveMatch = responseText.match(/DIRECTIVE:\s*(.+)/i);
    let agentReply = responseText;
    let extractedDirective: string | null = null;

    if (directiveMatch) {
      const directive = directiveMatch[1].trim();
      agentReply = responseText.slice(0, directiveMatch.index).trim();
      if (directive.toLowerCase() !== 'none' && directive.length > 5) {
        extractedDirective = directive;
        await addVoiceDirective(id, directive);
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

    return NextResponse.json({
      reply: agentReply,
      directive: extractedDirective,
      directives: await getVoiceDirectives(id),
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Voice chat failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
