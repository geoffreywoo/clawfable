import { NextRequest, NextResponse } from 'next/server';
import { getPublicSoulProfile } from '@/lib/dashboard-data';

// GET /api/public/agent/[handle] — public agent profile, no auth required
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  try {
    const profile = await getPublicSoulProfile(handle);
    if (!profile) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
  }
}
