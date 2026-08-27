import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getProductFacts, getUser, upsertProductFact } from '@/lib/kv-storage';

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) return NextResponse.json({ error: authError.message }, { status: authError.status });
  const includeExpired = request.nextUrl.searchParams.get('includeExpired') === 'true';
  return NextResponse.json({ facts: await getProductFacts({ includeExpired }) });
}

export async function POST(request: NextRequest) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) return NextResponse.json({ error: authError.message }, { status: authError.status });

  const body = await request.json().catch(() => null);
  const statement = typeof body?.statement === 'string' ? body.statement.replace(/\s+/g, ' ').trim() : '';
  const provenanceUrl = typeof body?.provenanceUrl === 'string' ? body.provenanceUrl.trim() : '';
  const provenanceLabel = typeof body?.provenanceLabel === 'string' ? body.provenanceLabel.replace(/\s+/g, ' ').trim() : '';
  const verifiedByUserId = typeof body?.verifiedByUserId === 'string' ? body.verifiedByUserId.trim() : '';
  const expiresAt = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
  const expiryMs = Date.parse(expiresAt);
  if (!statement || statement.length > 1000) {
    return NextResponse.json({ error: 'statement is required and must be at most 1000 characters' }, { status: 400 });
  }
  if (!validHttpsUrl(provenanceUrl) || !provenanceLabel || !verifiedByUserId) {
    return NextResponse.json({ error: 'HTTPS provenanceUrl, provenanceLabel, and verifiedByUserId are required' }, { status: 400 });
  }
  if (!await getUser(verifiedByUserId)) {
    return NextResponse.json({ error: 'verifiedByUserId must identify an existing Clawfable owner' }, { status: 400 });
  }
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now() || expiryMs > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'expiresAt must be within the next 366 days' }, { status: 400 });
  }

  const fact = await upsertProductFact({
    id: typeof body?.id === 'string' ? body.id : undefined,
    statement,
    provenanceUrl,
    provenanceLabel,
    verifiedByUserId,
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(expiryMs).toISOString(),
    active: body?.active !== false,
  });
  return NextResponse.json({ fact });
}
