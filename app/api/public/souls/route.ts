import { NextResponse } from 'next/server';
import { getPublicSoulSummaries } from '@/lib/dashboard-data';

// GET /api/public/souls — public, no auth required
export async function GET() {
  try {
    return NextResponse.json(await getPublicSoulSummaries());
  } catch {
    return NextResponse.json({ error: 'Failed to fetch souls' }, { status: 500 });
  }
}
