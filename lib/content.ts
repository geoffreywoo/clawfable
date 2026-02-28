import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const CONTENT_ROOT = path.join(process.cwd(), 'content');

export const coreSections = ['soul', 'memory'] as const;

export type CoreSection = (typeof coreSections)[number];

export function isCoreSection(section: string): section is CoreSection {
  return coreSections.includes(section.toLowerCase() as CoreSection);
}

const scopeOrder = ['soul', 'memory', 'user_files'];
const revisionOrder = ['draft', 'review', 'accepted', 'archived'];

function extractScopeTags(scopeMap?: Record<string, unknown>): string[] {
  if (!scopeMap) return [];
  return scopeOrder.filter((key) => scopeMap[key] === true);
}

function extractRevision(meta: Record<string, unknown> | undefined) {
  if (!meta) return null;
  const revision = (meta as Record<string, unknown>).revision as Record<string, unknown> | undefined;
  if (!revision || typeof revision !== 'object') return null;

  const status = String(revision.status || 'draft');
  const kind = String(revision.kind || revision.type || 'revision');
  const family = String(revision.family || 'default');
  const id = String(revision.id || revision.version || 'v1');

  return {
    family,
    id,
    status: revisionOrder.includes(status.toLowerCase()) ? status.toLowerCase() : status,
    kind: kind,
    parent: revision.parent_revision ? String(revision.parent_revision) : undefined,
    source: revision.fork_of
      ? String(revision.fork_of)
      : revision.source
        ? String(revision.source)
        : undefined
  };
}

function shortDescription(frontmatter: Record<string, unknown> | undefined, content: string) {
  const fromFrontmatter = typeof frontmatter?.description === 'string' ? frontmatter.description.trim() : '';
  if (fromFrontmatter) {
    return fromFrontmatter;
  }
  const titleLine = content.split('\n').find((line) => line.startsWith('# '));
  const firstBody = content
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .slice(0, 4)
    .join(' ');
  const fallback = titleLine ? titleLine.replace(/^#\s+/, '') : 'Wiki article in this section.';
  const cleaned = firstBody || fallback;
  return cleaned.replace(/\s+/g, ' ').slice(0, 180);
}

export function listSections(): string[] {
  return coreSections.filter((section) => fs.existsSync(path.join(CONTENT_ROOT, section)));
}

function listMarkdownFiles(sectionDir: string, prefix = '') {
  if (!fs.existsSync(sectionDir)) return [];
  const entries = fs.readdirSync(sectionDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = listMarkdownFiles(path.join(sectionDir, entry.name), `${prefix}${entry.name}/`);
      files.push(...nested);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const file = entry.name;
    const full = path.join(sectionDir, file);
    const raw = fs.readFileSync(full, 'utf8');
    const { data, content } = matter(raw);
    const titleLine = content.split('\n').find((l) => l.startsWith('# '));
    const slug = `${prefix}${file.replace(/\.md$/, '')}`;
    const sourcePath = `${prefix}${file}`;

    files.push({
      slug,
      sourcePath,
      title: (data as any).title
        ? (data as any).title
        : titleLine
          ? titleLine.replace(/^#\s+/, '')
          : file.replace(/\.md$/, ''),
      description: shortDescription(data as Record<string, unknown>, content),
      scopeFlags: extractScopeTags(data?.copy_paste_scope as Record<string, unknown> | undefined),
      revision: extractRevision(data as Record<string, unknown> | undefined),
      data
    });
  }

  return files;
}

export function listBySection(section: string) {
  if (!isCoreSection(section)) {
    return [];
  }
  const dir = path.join(CONTENT_ROOT, section.toLowerCase());
  return listMarkdownFiles(dir);
}

export function getDoc(section: string, slug: string | string[]) {
  if (!isCoreSection(section)) return null;
  const normalizedSlug = Array.isArray(slug) ? slug.join('/') : slug;
  const full = path.join(CONTENT_ROOT, section, `${normalizedSlug}.md`);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8');
  const { data, content } = matter(raw);
  return { data, content };
}

export function getRootDoc(slug: string) {
  const full = path.join(CONTENT_ROOT, `${slug}.md`);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8');
  const { data, content } = matter(raw);
  return { data, content };
}
