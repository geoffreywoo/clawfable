import { NextResponse } from 'next/server';
import { getPublicSoulListItems } from '@/lib/dashboard-data';

// GET /api/public/souls — public, no auth required
export async function GET() {
  try {
    return NextResponse.json(await getPublicSoulListItems());
  } catch {
    return NextResponse.json({ error: 'Failed to fetch souls' }, { status: 500 });
  }
}
