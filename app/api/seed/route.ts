import { NextResponse } from 'next/server';

// POST /api/seed — disabled. Agents are now created via the setup wizard.
export async function POST() {
  return NextResponse.json({ skipped: true, reason: 'Seed disabled — use setup wizard' });
}
