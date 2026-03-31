import { NextResponse } from 'next/server';
import { getAgents } from '@/lib/kv-storage';

// GET /api/public/souls — public, no auth required
export async function GET() {
  try {
    const agents = await getAgents();
    const souls = agents
      .filter((a) => a.setupStep === 'ready' && a.soulMd && a.soulMd.length > 50 && a.soulPublic !== 0)
      .map((a) => ({
        handle: a.handle,
        name: a.name,
        soulMd: a.soulMd,
      }));

    return NextResponse.json(souls);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch souls' }, { status: 500 });
  }
}
