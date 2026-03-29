import { NextResponse } from 'next/server';
import { getCronLog } from '@/lib/kv-storage';
import { requireUser, handleAuthError } from '@/lib/auth';

// GET /api/cron/log — get recent cron run history
export async function GET() {
  try {
    await requireUser();
    const log = await getCronLog(30);
    return NextResponse.json(log);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch cron log' }, { status: 500 });
  }
}
