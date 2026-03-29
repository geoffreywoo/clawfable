import { NextResponse } from 'next/server';
import { getCronLog, getUserAgentIds } from '@/lib/kv-storage';
import { requireUser, handleAuthError } from '@/lib/auth';

// GET /api/cron/log — get cron history filtered to the current user's agents
export async function GET() {
  try {
    const user = await requireUser();
    const userAgentIds = new Set((await getUserAgentIds(user.id)).map(String));
    const log = await getCronLog(50);

    // Filter each entry to only include results for this user's agents
    const filtered = log
      .map((entry) => ({
        ...entry,
        results: entry.results.filter((r) => userAgentIds.has(String(r.agentId))),
      }))
      .filter((entry) => entry.results.length > 0 || entry.mentionsRefreshed > 0);

    return NextResponse.json(filtered);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch cron log' }, { status: 500 });
  }
}
