import { NextResponse } from 'next/server';
import { getAgents, getLearnings } from '@/lib/kv-storage';

// GET /api/public/souls — public, no auth required
export async function GET() {
  try {
    const agents = await getAgents();
    const publicAgents = agents.filter(
      (a) => a.setupStep === 'ready' && a.soulMd && a.soulMd.length > 50 && a.soulPublic !== 0
    );

    const souls = await Promise.all(
      publicAgents.map(async (a) => {
        const learnings = await getLearnings(a.id);
        return {
          handle: a.handle,
          name: a.name,
          soulMd: a.soulMd,
          soulSummary: a.soulSummary,
          totalTracked: learnings?.totalTracked ?? 0,
          avgLikes: learnings?.avgLikes ?? 0,
        };
      })
    );

    return NextResponse.json(souls);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch souls' }, { status: 500 });
  }
}
