import { NextRequest, NextResponse } from 'next/server';
import {
  getArtifactHistory,
  getRecentActivity,
  isCoreSection,
  type CoreSection
} from '@/lib/content';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isRecent = searchParams.get('recent') === 'true';

  if (isRecent) {
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? Math.min(100, Math.max(1, Number.parseInt(limitRaw, 10) || 20)) : 20;
    try {
      const entries = await getRecentActivity(limit);
      return NextResponse.json({ entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const section = searchParams.get('section') || '';
  const slug = searchParams.get('slug') || '';

  if (!section || !isCoreSection(section)) {
    return NextResponse.json(
      { error: 'Invalid section. Use soul or memory.' },
      { status: 400 }
    );
  }

  if (!slug) {
    return NextResponse.json({ error: 'slug is required.' }, { status: 400 });
  }

  try {
    const entries = await getArtifactHistory(section as CoreSection, slug);
    return NextResponse.json({ section, slug, entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
