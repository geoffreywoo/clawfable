import { NextRequest, NextResponse } from 'next/server';
import { listBySection } from '@/lib/content';

function handleFromSlug(slug: string) {
  const m = slug.match(/^forks\/([^/]+)\//i);
  return m ? m[1] : '';
}

export async function GET(request: NextRequest) {
  const handle = (new URL(request.url).searchParams.get('handle') || '').trim().replace(/^@/, '').toLowerCase();
  if (!handle) {
    return NextResponse.json({ error: 'handle query param is required.' }, { status: 400 });
  }

  const items = await listBySection('soul');
  const candidates = items.filter((it) => handleFromSlug(it.slug).toLowerCase() === handle);
  if (!candidates.length) {
    return NextResponse.json({ ok: false, status: 'not_found', handle }, { status: 404 });
  }

  candidates.sort((a, b) => {
    const au = (a.data as Record<string, any> | undefined)?.updated_at || (a.data as Record<string, any> | undefined)?.created_at || 0;
    const bu = (b.data as Record<string, any> | undefined)?.updated_at || (b.data as Record<string, any> | undefined)?.created_at || 0;
    const ta = new Date(String(au)).getTime();
    const tb = new Date(String(bu)).getTime();
    return tb - ta;
  });

  const latest = candidates[0];
  const data = (latest.data as Record<string, any> | undefined) || {};
  const rev = (data.revision as Record<string, any> | undefined) || (latest.revision as Record<string, any> | undefined) || {};
  const source = rev.source || null;

  return NextResponse.json({
    ok: true,
    api_version: 'v1',
    handle,
    current_slug: latest.slug,
    canonical_url: `https://www.clawfable.com/soul/${latest.slug}`,
    revision: rev,
    source_slug: source,
    author_commentary: data.author_commentary || null,
    updated_at: data.updated_at || null,
    status: rev.status || null
  });
}
