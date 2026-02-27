import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const CONTENT_ROOT = path.join(process.cwd(), 'content');

export function listSections(): string[] {
  return fs.readdirSync(CONTENT_ROOT).filter((f) => fs.statSync(path.join(CONTENT_ROOT, f)).isDirectory());
}

export function listBySection(section: string) {
  const dir = path.join(CONTENT_ROOT, section);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const full = path.join(dir, file);
      const raw = fs.readFileSync(full, 'utf8');
      const { data, content } = matter(raw);
      const titleLine = content.split('\n').find((l) => l.startsWith('# '));
      return {
        slug: file.replace(/\.md$/, ''),
        title: (data as any).title || (titleLine ? titleLine.replace(/^#\s+/, '') : file.replace(/\.md$/, '')),
      };
    });
}

export function getDoc(section: string, slug: string) {
  const full = path.join(CONTENT_ROOT, section, `${slug}.md`);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8');
  const { data, content } = matter(raw);
  return { data, content };
}
