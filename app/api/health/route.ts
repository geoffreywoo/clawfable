import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Public deploy-verification endpoint: reports which commit is live so a
// push to main can be confirmed against the running deployment without
// Vercel API access. No secrets, no storage reads.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    deployedAt: process.env.VERCEL_DEPLOYMENT_COMPLETED_AT || null,
    now: new Date().toISOString(),
  });
}
