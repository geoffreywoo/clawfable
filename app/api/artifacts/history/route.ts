import { NextRequest, NextResponse } from 'next/server';
import { getArtifactHistory, appendHistory, isCoreSection } from '../../../../lib/content';
import type { HistoryEntry } from '../../../../lib/content';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') ?? '';
  const slug = searchParams.get('slug') ?? '';

  if (!isCoreSection(section) || !slug) {
    return NextResponse.json({ error: 'section and slug are required' }, { status: 400 });
  }

  const history = await getArtifactHistory(section, slug);
  return NextResponse.json({ history });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { section, slug, entry } = body as { section: string; slug: string; entry: HistoryEntry };

  if (!isCoreSection(section) || !slug || !entry) {
    return NextResponse.json({ error: 'section, slug, and entry are required' }, { status: 400 });
  }

  await appendHistory(section, slug, {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
