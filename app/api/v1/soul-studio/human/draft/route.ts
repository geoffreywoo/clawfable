import { NextRequest, NextResponse } from 'next/server';
import { buildHumanSoul, HumanDraftInput } from '@/lib/soul-studio';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Partial<HumanDraftInput>;
  if (!body.handle || !body.objective || !body.values || !body.edge || !body.antiGoals || !body.voice || !body.riskPolicy) {
    return NextResponse.json({ error: 'Missing required fields for human SOUL draft.' }, { status: 400 });
  }

  const soul = buildHumanSoul(body as HumanDraftInput);
  return NextResponse.json({
    ok: true,
    mode: 'human',
    soul_md: soul,
    checklist: [
      'Does this encode a clear objective function?',
      'Are anti-goals explicit?',
      'Is risk policy actionable?',
      'Can another model execute this reliably?'
    ]
  });
}
