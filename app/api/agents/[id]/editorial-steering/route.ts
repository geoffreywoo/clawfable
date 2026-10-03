import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getDraftCandidates, getIdeaCandidates } from '@/lib/kv-storage';
import { readJsonObjectBody } from '@/lib/request-validation';
import {
  EditorialSteeringError, getEditorialSteering, getEditorialSteeringRequest, parseEditorialSteeringInput,
  revokeEditorialSteering, saveEditorialSteering,
} from '@/lib/editorial-steering';

type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  try { return handleAuthError(error); } catch {}
  if (error instanceof EditorialSteeringError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: 'Unable to save editorial direction' }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    await requireAgentAccess(id);
    return NextResponse.json({ records: await getEditorialSteering(id) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user } = await requireAgentAccess(id);
    const body = await readJsonObjectBody(request);
    if (!body.ok || !body.value) throw new EditorialSteeringError(body.error || 'Invalid JSON body');
    // Expiry is checked on first durable insertion, allowing exact request retries after expiry.
    const input = parseEditorialSteeringInput(body.value, -Infinity);
    const existing = await getEditorialSteeringRequest(id, String(user.id), input);
    if (existing) return NextResponse.json({ record: existing });
    if (input.ideaId) {
      const ideas = await getIdeaCandidates(id, 1000);
      if (!ideas.some(idea => idea.id === input.ideaId && String(idea.agentId) === id))
        throw new EditorialSteeringError('Idea not found', 404);
    }
    if (input.draftId) {
      const drafts = await getDraftCandidates(id, 1000);
      const draft = drafts.find(row => row.id === input.draftId && String(row.agentId) === id);
      if (!draft || input.ideaId && draft.ideaId !== input.ideaId) throw new EditorialSteeringError('Draft not found', 404);
    }
    return NextResponse.json({ record: await saveEditorialSteering(id, String(user.id), input) });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user } = await requireAgentAccess(id);
    const parsed = await readJsonObjectBody(request);
    if (!parsed.ok || !parsed.value) throw new EditorialSteeringError(parsed.error || 'Invalid JSON body');
    const body = parsed.value;
    if (Object.keys(body).some(key => !['id', 'requestId'].includes(key)) || typeof body.id !== 'string' || typeof body.requestId !== 'string')
      throw new EditorialSteeringError('Provide only id and requestId');
    return NextResponse.json({ record: await revokeEditorialSteering(id, String(user.id), body.id, body.requestId),
      effect: 'future_jobs', existingJobGuidanceUnchanged: true });
  } catch (error) { return failure(error); }
}
