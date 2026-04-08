import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getBillingSummary } from '@/lib/billing';
import { getUserAgentIds } from '@/lib/kv-storage';

// GET /api/auth/me — return current logged-in user
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  const agentCount = (await getUserAgentIds(user.id)).length;
  return NextResponse.json({
    id: user.id,
    username: user.username,
    name: user.name,
    billing: getBillingSummary(user, agentCount),
  });
}
