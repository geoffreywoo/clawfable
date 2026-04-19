import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/kv-storage';
import { COOKIE_NAME } from '@/lib/auth';
import { getSessionCookieOptions } from '@/lib/session-cookie';

// POST /api/auth/logout
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (token) {
      await deleteSession(token);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAME, '', getSessionCookieOptions(request.nextUrl.origin, { maxAge: 0 }));
    return response;
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
