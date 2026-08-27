import { NextResponse } from 'next/server';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { getCurrentUser } from '@/lib/auth';
import { getBillingSummary } from '@/lib/billing';

// GET /api/auth/me — return current logged-in user
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  const agentCount = await getAccessibleAgentCount(user);
  return NextResponse.json({
    id: user.id,
    username: user.username,
    name: user.name,
    billing: getBillingSummary(user, agentCount),
  });
}
