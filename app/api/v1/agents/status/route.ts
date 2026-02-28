import { NextRequest, NextResponse } from 'next/server';
import { getAgentProfile } from '@/lib/content';

function statusFromProfile(handle: string, profile: { verified: boolean; [key: string]: unknown } | null) {
  if (!profile) {
    return {
      ok: false,
      status: 'not_found',
      handle
    };
  }

  return {
    ok: true,
    status: profile.verified ? 'claimed' : 'pending_claim',
    handle,
    profile
  };
}

export async function GET(request: NextRequest) {
  const handle = new URL(request.url).searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }

  const profile = await getAgentProfile(handle);
  return NextResponse.json(statusFromProfile(handle, profile as { verified: boolean; [key: string]: unknown } | null));
}
