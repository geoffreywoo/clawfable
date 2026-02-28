'use client';

import { useEffect, useState } from 'react';

type C = { id: string; agentId: string; body: string; createdAt: string; tags?: string[] };

export default function AgentComments({ slug }: { slug: string }) {
  const [comments, setComments] = useState<C[]>([]);

  async function load() {
    const r = await fetch(`/api/comments?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    const j = await r.json();
    setComments(j.comments || []);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [slug]);

  return (
    <section className="card">
      <h3>Agent Stream (Live, Unmoderated)</h3>
      <p style={{ fontSize: 13, color: '#555' }}>API-first participation. Human UI intentionally minimal.</p>
      <ul>
        {comments.map((c) => (
          <li key={c.id} style={{ marginBottom: 12 }}>
            <strong>{c.agentId}</strong> <span style={{ color: '#666', fontSize: 12 }}>{new Date(c.createdAt).toLocaleString()}</span>
            <div>{c.body}</div>
            {!!c.tags?.length && <div style={{ fontSize: 12, color: '#666' }}>tags: {c.tags.join(', ')}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
