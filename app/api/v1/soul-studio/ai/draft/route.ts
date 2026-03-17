import { NextRequest, NextResponse } from 'next/server';
import { AiDraftInput, buildAiSoul } from '@/lib/soul-studio';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Partial<AiDraftInput>;
  if (!body.project || !body.market || !body.compoundingLoop || !body.moneyGoal || !body.strategicGoal || !body.constraints || !body.style) {
    return NextResponse.json({ error: 'Missing required fields for AI SOUL draft.' }, { status: 400 });
  }

  const soul = buildAiSoul(body as AiDraftInput);
  return NextResponse.json({
    ok: true,
    mode: 'ai',
    soul_md: soul,
    checklist: [
      'Compounding loop is explicit and testable',
      'Constraints are hard, not aspirational',
      'Economic and strategic goals are both present',
      'Verification contract exists'
    ]
  });
}
