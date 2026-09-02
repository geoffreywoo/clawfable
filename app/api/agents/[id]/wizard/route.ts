import { NextRequest, NextResponse } from 'next/server';
import {
  updateAgent,
  saveWizardData,
  saveStyleSignals,
  saveSoulBackup,
  checkRateLimit,
  logFunnelEvent,
} from '@/lib/kv-storage';
import { extractStyleSignals, generateSoulMd } from '@/lib/soul-generation';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import type { WizardData } from '@/lib/types';
import { readJsonObjectBody } from '@/lib/request-validation';

const ARCHETYPES = ['contrarian', 'optimist', 'analyst', 'provocateur', 'educator'];

// POST /api/agents/[id]/wizard — generate SOUL.md from guided builder inputs
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    // Rate limit: max 5 wizard submissions per hour
    const allowed = await checkRateLimit(id, 'wizard', 5);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
    const { exampleTweets, archetype, topics, frequency } = body as Record<string, any>;

    // Validate inputs
    if (!archetype || !ARCHETYPES.includes(archetype)) {
      return NextResponse.json({ error: 'Pick a voice archetype' }, { status: 400 });
    }
    if (!topics || !Array.isArray(topics) || topics.length === 0) {
      return NextResponse.json({ error: 'Pick at least one topic' }, { status: 400 });
    }

    const examples: string[] = Array.isArray(exampleTweets)
      ? exampleTweets.filter((t: string) => typeof t === 'string' && t.trim().length > 0)
      : [];

    // Log funnel event
    await logFunnelEvent(id, 'wizard_soul_complete', { archetype, topicCount: topics.length, exampleCount: examples.length });

    // Backup existing SOUL.md if it's not the placeholder
    if (agent.soulMd && agent.soulMd !== '# Pending SOUL.md setup') {
      await saveSoulBackup(id, agent.soulMd);
    }

    // Parallel model calls: SOUL.md generation + style extraction
    const [soulMd, styleSignals] = await Promise.all([
      generateSoulMd(archetype, topics, examples, agent.name),
      examples.length > 0
        ? extractStyleSignals(examples)
        : Promise.resolve({ sentenceLength: 'mixed' as const, vocabulary: 'mixed' as const, toneMarkers: [], topicPreferences: topics, rawExtraction: '' }),
    ]);

    // Save everything in parallel
    const wizardData: WizardData = {
      exampleTweets: examples,
      archetype,
      topics,
      frequency: frequency || '3x',
      createdAt: new Date().toISOString(),
    };

    await Promise.all([
      updateAgent(id, { soulMd, setupStep: 'analyze' }),
      saveWizardData(id, wizardData),
      saveStyleSignals(id, styleSignals),
    ]);

    return NextResponse.json({
      soulMd,
      styleSignals,
      wizardData,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Wizard failed';
    console.error('wizard error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
