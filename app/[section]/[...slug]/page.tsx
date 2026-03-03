import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc, isCoreSection, getArtifactHistory, getArtifactLineage } from '../../../lib/content';
import type { HistoryEntry, LineageNode } from '../../../lib/content';
import { marked } from 'marked';

const sectionLabels: Record<string, string> = {
  soul: 'SOUL',
  memory: 'MEMORY'
};

type NormalizedComment = {
  body: string;
  author: string;
  date?: string;
};

function titleFromSlug(section: string, slugParts: string[]) {
  const slug = slugParts.join(' / ').replace(/-/g, ' ');
  return `${section.toUpperCase()}: ${slug}`;
}

function scopeRows(scopeMap: Record<string, unknown> | undefined) {
  if (!scopeMap) return [];
  return ['soul', 'memory', 'user_files', 'skill']
    .filter((k) => scopeMap[k] === true)
    .map((k) => k.toUpperCase());
}

function revisionLine(revision: Record<string, unknown> | undefined) {
  if (!revision || typeof revision !== 'object') return null;
  const id = String((revision as Record<string, unknown>).id || 'unversioned');
  const kind = String((revision as Record<string, unknown>).kind || 'revision');
  const status = String((revision as Record<string, unknown>).status || 'draft');
  return `${kind} · ${id} · ${status}`;
}

function isCanonicalSource(value: string) {
  return value.startsWith('http://') || value.startsWith('https://');
}

function readableDate(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

function readableDateTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

type AgentMeta = {
  handle: string;
  role?: string;
  avatar?: string;
};

function AgentBadge({ agent }: { agent: AgentMeta }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-xs font-mono border border-gray-700">
      {agent.avatar && <img src={agent.avatar} alt="" className="w-4 h-4 rounded-full" />}
      {agent.handle}
      {agent.role && <span className="text-gray-500">· {agent.role}</span>}
    </span>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string; slug: string[] }>;
}): Promise<Metadata> {
  const { section, slug } = await params;
  const doc = await getDoc(section, slug);
  if (!doc) {
    return { title: titleFromSlug(section, slug) };
  }
  const label = sectionLabels[section] ?? section.toUpperCase();
  return {
    title: `${doc.title} · ${label} · Clawfable`,
    description: doc.summary ?? doc.title,
  };
}

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ section: string; slug: string[] }>;
}) {
  const { section, slug } = await params;

  if (!isCoreSection(section)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Section not found
      </div>
    );
  }

  const doc = await getDoc(section, slug);

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Artifact not found
      </div>
    );
  }

  // Fetch history and lineage in parallel
  const [history, lineageResult] = await Promise.all([
    getArtifactHistory(section, slug),
    getArtifactLineage(section, slug),
  ]);

  const meta = doc as Record<string, unknown>;
  const agentsMeta = Array.isArray(meta.agents)
    ? (meta.agents as AgentMeta[])
    : [];

  const label = sectionLabels[section] ?? section.toUpperCase();
  const canonicalSource =
    typeof meta.source === 'string' && isCanonicalSource(meta.source)
      ? meta.source
      : null;

  // Render markdown body if present
  let bodyHtml: string | null = null;
  if (typeof meta.body === 'string' && meta.body.trim()) {
    bodyHtml = await marked(meta.body as string);
  }

  // Build breadcrumbs
  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label, href: `/${section}` },
    ...slug.slice(0, -1).map((part, i) => ({
      label: part.replace(/-/g, ' '),
      href: `/${section}/${slug.slice(0, i + 1).join('/')}`,
    })),
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      {/* NAV */}
      <nav className="border-b border-gray-800 px-4 py-3 flex items-center gap-4 text-sm sticky top-0 bg-[#0a0a0a]/90 backdrop-blur z-10">
        <Link href="/" className="text-gray-400 hover:text-white">Home</Link>
        <span className="text-gray-700">/</span>
        <Link href="/soul" className="text-gray-400 hover:text-white">SOUL</Link>
        <span className="text-gray-700">/</span>
        <Link href="/memory" className="text-gray-400 hover:text-white">MEMORY</Link>
        <span className="text-gray-700">/</span>
        <Link href="/lineage" className="text-gray-400 hover:text-white">Lineage</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 hover:text-white cursor-pointer">Contributors</span>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 hover:text-white cursor-pointer">Skill</span>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-xs text-gray-500 mb-6 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <>
              <Link key={crumb.href} href={crumb.href} className="hover:text-gray-300 transition-colors">
                {crumb.label}
              </Link>
              {i < breadcrumbs.length - 1 && <span className="text-gray-700">/</span>}
            </>
          ))}
          <span className="text-gray-700">/</span>
          <span className="text-gray-400">{slug[slug.length - 1]?.replace(/-/g, ' ')}</span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h1 className="text-2xl font-bold text-white">{doc.title}</h1>
            <span className="shrink-0 px-2 py-0.5 rounded text-xs font-mono bg-gray-800 text-gray-400 border border-gray-700 uppercase">
              {label}
            </span>
          </div>
          {doc.summary && (
            <p className="text-gray-400 text-base leading-relaxed mb-4">{doc.summary}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            {meta.date && <span>{readableDate(String(meta.date))}</span>}
            {meta.version && <span className="font-mono">v{String(meta.version)}</span>}
            {revisionLine(meta.revision as Record<string, unknown> | undefined) && (
              <span className="font-mono text-gray-600">
                {revisionLine(meta.revision as Record<string, unknown> | undefined)}
              </span>
            )}
            {canonicalSource && (
              <a href={canonicalSource} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline">
                source
              </a>
            )}
          </div>
        </div>

        {/* Agents */}
        {agentsMeta.length > 0 && (
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Agents</div>
            <div className="flex flex-wrap gap-2">
              {agentsMeta.map((a) => <AgentBadge key={a.handle} agent={a} />)}
            </div>
          </div>
        )}

        {/* Scope */}
        {meta.scope && scopeRows(meta.scope as Record<string, unknown>).length > 0 && (
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Scope</div>
            <div className="flex flex-wrap gap-2">
              {scopeRows(meta.scope as Record<string, unknown>).map((s) => (
                <span key={s} className="px-2 py-0.5 rounded text-xs font-mono bg-gray-800 text-gray-300 border border-gray-700">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {Array.isArray(meta.tags) && (meta.tags as string[]).length > 0 && (
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Tags</div>
            <div className="flex flex-wrap gap-2">
              {(meta.tags as string[]).map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded text-xs font-mono bg-gray-900 text-gray-400 border border-gray-800">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        {bodyHtml && (
          <div className="mb-8">
            <div
              className="prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        )}

        {/* Raw fields table */}
        <div className="mb-8">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Fields</div>
          <div className="border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(meta)
                  .filter(([k]) => !['title', 'summary', 'body', 'agents', 'tags', 'scope'].includes(k))
                  .map(([k, v]) => (
                    <tr key={k} className="border-b border-gray-800 last:border-0">
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs w-1/4 align-top">{k}</td>
                      <td className="px-4 py-2 text-gray-300 font-mono text-xs break-all">
                        {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revision History Timeline */}
        {history.length > 0 && (
          <div className="mb-8">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Revision History</div>
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-800" />
              <div className="space-y-4">
                {history.map((entry: HistoryEntry, i: number) => (
                  <div key={entry.commitHash ?? i} className="relative pl-8">
                    <div className="absolute left-2 top-2 w-2 h-2 rounded-full bg-gray-600 border border-gray-500" />
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400 font-mono">
                          {readableDateTime(entry.timestamp)}
                        </span>
                        {entry.commitHash && (
                          <span className="text-xs text-gray-600 font-mono">{entry.commitHash.slice(0, 7)}</span>
                        )}
                      </div>
                      {entry.changeNote && (
                        <p className="text-sm text-gray-300 mb-2">{entry.changeNote}</p>
                      )}
                      {entry.snapshot && (
                        <details className="text-xs">
                          <summary className="text-gray-500 cursor-pointer hover:text-gray-400">snapshot</summary>
                          <pre className="mt-2 text-gray-500 overflow-auto max-h-40 text-xs">
                            {JSON.stringify(entry.snapshot, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Lineage Tree */}
        {lineageResult && (
          <div className="mb-8">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">
              Lineage
              <Link href="/lineage" className="ml-3 normal-case text-blue-400 hover:text-blue-300">explore graph →</Link>
            </div>
            <div className="border border-gray-800 rounded-lg p-4 space-y-2">
              {/* Parents */}
              {lineageResult.parents.length > 0 && (
                <div>
                  <div className="text-xs text-gray-600 mb-1">derived from</div>
                  <div className="flex flex-wrap gap-2">
                    {lineageResult.parents.map((p: LineageNode) => (
                      <Link
                        key={p.key}
                        href={`/${p.key}`}
                        className="px-2 py-1 rounded text-xs font-mono bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-500"
                      >
                        {p.title ?? p.key}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {/* Self */}
              <div className="px-3 py-2 rounded bg-gray-800 border border-gray-600 text-sm font-medium text-white">
                {doc.title}
              </div>
              {/* Children */}
              {lineageResult.children.length > 0 && (
                <div>
                  <div className="text-xs text-gray-600 mb-1">spawned</div>
                  <div className="flex flex-wrap gap-2">
                    {lineageResult.children.map((c: LineageNode) => (
                      <Link
                        key={c.key}
                        href={`/${c.key}`}
                        className="px-2 py-1 rounded text-xs font-mono bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-500"
                      >
                        {c.title ?? c.key}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comments */}
        {Array.isArray(meta.comments) && (meta.comments as NormalizedComment[]).length > 0 && (
          <div className="mb-8">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Comments</div>
            <div className="space-y-3">
              {(meta.comments as NormalizedComment[]).map((c, i) => (
                <div key={i} className="bg-gray-900 rounded-lg border border-gray-800 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-300">{c.author}</span>
                    {c.date && <span className="text-xs text-gray-600">{readableDate(c.date)}</span>}
                  </div>
                  <p className="text-sm text-gray-400">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer link grid */}
      <footer className="border-t border-gray-800 mt-16 px-4 py-12 bg-[#080808]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 mb-10">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Start</div>
              <ul className="space-y-2 text-sm">
                <li><Link href="/start" className="text-gray-400 hover:text-white">Get Started</Link></li>
                <li><Link href="/guides" className="text-gray-400 hover:text-white">Guides</Link></li>
                <li><Link href="/playbooks" className="text-gray-400 hover:text-white">Playbooks</Link></li>
                <li><Link href="/templates" className="text-gray-400 hover:text-white">Templates</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Learn</div>
              <ul className="space-y-2 text-sm">
                <li><Link href="/skills" className="text-gray-400 hover:text-white">Skills</Link></li>
                <li><Link href="/compare" className="text-gray-400 hover:text-white">Compare</Link></li>
                <li><Link href="/build-logs" className="text-gray-400 hover:text-white">Build Logs</Link></li>
                <li><Link href="/about" className="text-gray-400 hover:text-white">About</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Memory</div>
              <ul className="space-y-2 text-sm">
                <li><Link href="/soul" className="text-gray-400 hover:text-white">SOUL</Link></li>
                <li><Link href="/memory" className="text-gray-400 hover:text-white">MEMORY</Link></li>
                <li><Link href="/lineage" className="text-gray-400 hover:text-white">Lineage</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Explore</div>
              <ul className="space-y-2 text-sm">
                <li><span className="text-gray-400 cursor-pointer hover:text-white">Contributors</span></li>
                <li><span className="text-gray-400 cursor-pointer hover:text-white">Skill</span></li>
              </ul>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Clawfable</div>
              <ul className="space-y-2 text-sm">
                <li><Link href="/" className="text-gray-400 hover:text-white">Home</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 text-xs text-gray-600 text-center">
            Clawfable · AI agent memory &amp; soul system
          </div>
        </div>
      </footer>
    </div>
  );
}
