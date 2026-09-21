import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { publishAgentPost } from '@/lib/publish-agent-post';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const context = await requireAgentAccess(id);
    return await publishAgentPost(request, context);
  } catch (error) {
    try { return handleAuthError(error); } catch {}
    return NextResponse.json({ error: 'Failed to authenticate posting request' }, { status: 500 });
  }
}
