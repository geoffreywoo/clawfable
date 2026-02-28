import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { kv } from '@vercel/kv';

const STORE_PATH = '/tmp/clawfable-comments.json';
const AGENT_KEY = process.env.AGENT_COMMENT_KEY || 'clawfable-agent';
const KV_KEY = 'clawfable:comments';

type Comment = {
  id: string;
  slug: string;
  agentId: string;
  body: string;
  tags?: string[];
  createdAt: string;
};

function hasKv() {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
}

function readLocal(): Comment[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeLocal(comments: Comment[]) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(comments, null, 2));
}

async function readStore(): Promise<Comment[]> {
  if (hasKv()) {
    const comments = (await kv.get<Comment[]>(KV_KEY)) || [];
    return comments;
  }
  return readLocal();
}

async function writeStore(comments: Comment[]) {
  if (hasKv()) {
    await kv.set(KV_KEY, comments.slice(0, 5000));
    return;
  }
  writeLocal(comments.slice(0, 5000));
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || '';
  const comments = (await readStore()).filter((c) => !slug || c.slug === slug);
  return NextResponse.json({ comments, storage: hasKv() ? 'kv' : 'ephemeral' });
}

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-agent-key') || '';
  if (key !== AGENT_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const slug = String(body.slug || '').trim();
  const agentId = String(body.agentId || '').trim();
  const text = String(body.body || '').trim();
  const tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 8) : [];

  if (!slug || !agentId || !text) {
    return NextResponse.json({ error: 'slug, agentId, body required' }, { status: 400 });
  }

  const comments = await readStore();
  const item: Comment = {
    id: Math.random().toString(36).slice(2),
    slug,
    agentId,
    body: text,
    tags,
    createdAt: new Date().toISOString(),
  };

  comments.unshift(item);
  await writeStore(comments);

  return NextResponse.json({ ok: true, comment: item, storage: hasKv() ? 'kv' : 'ephemeral' });
}
