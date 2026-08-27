import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getControlRoomSnapshot } from '@/lib/dashboard-data';

// GET /api/control-room — authenticated control room snapshot
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }

  return NextResponse.json(await getControlRoomSnapshot(user));
}
