import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import {
  addLearningSignal,
  getTweet,
  getTweets,
  saveFeedback,
} from '@/lib/kv-storage';
import { buildTasteCalibrationQueue } from '@/lib/taste-calibration';
import { metadataWithStyleMode } from '@/lib/style-mode';

type TasteAction = 'more_like_this' | 'less_like_this' | 'edited';

function normalizeAction(value: unknown): TasteAction | null {
  if (value === 'more_like_this' || value === 'less_like_this' || value === 'edited') return value;
  return null;
}

// GET /api/agents/[id]/calibration — daily taste calibration candidates
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    return NextResponse.json(buildTasteCalibrationQueue(await getTweets(id)));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch calibration queue' }, { status: 500 });
  }
}

// POST /api/agents/[id]/calibration — record owner taste signal without mutating queue
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const body = await request.json().catch(() => ({}));
    const tweetId = typeof body?.tweetId === 'string' ? body.tweetId : '';
    const action = normalizeAction(body?.action);
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 240) : '';
    const editedContent = typeof body?.editedContent === 'string' ? body.editedContent.trim().slice(0, 1000) : '';

    if (!tweetId || !action) {
      return NextResponse.json({ error: 'tweetId and valid action are required' }, { status: 400 });
    }

    const tweet = await getTweet(tweetId);
    if (!tweet || String(tweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const signalType =
      action === 'more_like_this' ? 'taste_more_like_this' :
      action === 'less_like_this' ? 'taste_less_like_this' :
      'taste_calibration_edit';
    const rewardDelta =
      action === 'more_like_this' ? 0.52 :
      action === 'less_like_this' ? -0.56 :
      0.24;
    const preferenceHint =
      action === 'more_like_this' ? `Taste calibration: do more drafts like ${tweet.hookType || tweet.format || 'this shape'} on ${tweet.topic || 'this topic'}.` :
      action === 'less_like_this' ? `Taste calibration: avoid drafts like ${tweet.hookType || tweet.format || 'this shape'} on ${tweet.topic || 'this topic'}.` :
      'Taste calibration: owner edited the draft before it felt right.';

    if (action === 'less_like_this') {
      await saveFeedback(id, {
        tweetId: tweet.id,
        tweetText: tweet.content,
        rating: 'down',
        generatedAt: new Date().toISOString(),
        reason: reason || undefined,
        intentSummary: reason || preferenceHint,
        source: 'taste_calibration',
        userProvidedReason: Boolean(reason),
      });
    }

    await addLearningSignal(id, {
      tweetId: tweet.id,
      signalType,
      surface: 'queue',
      rewardDelta,
      reason: reason || preferenceHint,
      metadata: metadataWithStyleMode(tweet, {
        preferenceHint,
        calibrationAction: action,
        calibrationReason: reason || null,
        editedDraft: editedContent || null,
        confidenceScore: tweet.confidenceScore ?? null,
        candidateScore: tweet.candidateScore ?? null,
        hookType: tweet.hookType ?? null,
        toneType: tweet.toneType ?? null,
        specificityType: tweet.specificityType ?? null,
        structureType: tweet.structureType ?? null,
        draftExperimentId: tweet.draftExperimentId ?? null,
        creativeLane: tweet.creativeLane ?? null,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to save calibration signal' }, { status: 500 });
  }
}
