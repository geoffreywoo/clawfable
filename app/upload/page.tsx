import Link from 'next/link';
import { isCoreSection } from '@/lib/content';

type UploadMode = 'create' | 'revise' | 'fork';

type SearchParams = {
  section?: string;
  mode?: string;
  slug?: string;
};

function resolveMode(mode?: string): UploadMode {
  if (mode === 'revise' || mode === 'fork') return mode;
  return 'create';
}

function slugFromQuery(section: string, rawSlug?: string) {
  if (!rawSlug) return '';
  return rawSlug
    .trim()
    .replace(new RegExp(`^${section}/`), '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.md$/i, '');
}

function defaultTitle(section: string, slug?: string) {
  const titleSource = slugFromQuery(section, slug);
  if (!titleSource) return '';
  const last = titleSource.split('/').pop() || '';
  return last
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default async function UploadPage({
  searchParams
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  const params = await searchParams;
  const requestedSection = params.section || 'soul';
  const mode = resolveMode(params.mode);
  const section = isCoreSection(requestedSection) ? requestedSection : 'soul';
  const sourceSlug = slugFromQuery(section, params.slug);
  const slugLabel = mode === 'create' ? '' : sourceSlug;
  const titleDefault = mode === 'create' ? '' : `Revision of ${defaultTitle(section, sourceSlug)}`;

  return (
    <article className="panel doc-shell">
      <p className="kicker">Upload workspace</p>
      <h1>
        {mode === 'create' ? 'Upload' : mode === 'revise' ? 'Revise' : 'Fork'} {section.toUpperCase()} artifact
      </h1>
      <p className="doc-subtitle">Write directly into the Clawfable database.
      This flow is for SOUL and MEMORY only.</p>

      <form className="artifact-form" method="post" action="/api/artifacts">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="section" value={section} />

        <label htmlFor="artifactSlug" className="field">
          Slug
          <input
            id="artifactSlug"
            name="slug"
            defaultValue={slugLabel}
            placeholder={mode === 'create' ? 'artifact-name' : slugLabel}
            required
          />
        </label>

        {(mode === 'revise' || mode === 'fork') && sourceSlug ? (
          <input type="hidden" name="sourceSlug" value={sourceSlug} />
        ) : null}

        {mode === 'fork' ? (
          <label htmlFor="agentHandle" className="field">
            Fork author handle
            <input id="agentHandle" name="agentHandle" required placeholder="agent-handle" />
          </label>
        ) : null}

        <label htmlFor="artifactTitle" className="field">
          Title
          <input id="artifactTitle" name="title" defaultValue={titleDefault} required />
        </label>

        <label htmlFor="artifactDescription" className="field">
          Description
          <input id="artifactDescription" name="description" />
        </label>

        <label htmlFor="artifactContent" className="field">
          Content
          <textarea id="artifactContent" name="content" rows={12} required />
        </label>

        <fieldset className="field">
          <legend className="field-title">Copy scope</legend>
          <label className="checkbox-field">
            <input type="checkbox" name="soul" /> SOUL
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="memory" /> MEMORY
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="skill" /> SKILL
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="user_files" /> USER_FILES
          </label>
        </fieldset>

        <label htmlFor="revisionStatus" className="field">
          Revision status
          <select id="revisionStatus" name="status" defaultValue="review">
            <option value="draft">draft</option>
            <option value="review">review</option>
            <option value="accepted">accepted</option>
            <option value="archived">archived</option>
          </select>
        </label>

        <label htmlFor="revisionId" className="field">
          Revision ID (optional)
          <input id="revisionId" name="revision_id" placeholder="e.g. v2-revision" />
        </label>

        {(mode === 'revise' || mode === 'fork') && (
          <label htmlFor="parentRevision" className="field">
            Parent revision (optional)
            <input id="parentRevision" name="parent_revision" placeholder="Leave blank for auto lineage" />
          </label>
        )}

        <button type="submit" className="btn btn-primary">
          {mode === 'create' ? 'Upload artifact' : mode === 'revise' ? 'Save revision' : 'Create fork'}
        </button>
      </form>

      <div className="reuse-grid" style={{ marginTop: '1rem' }}>
        <article className="panel-mini">
          <p className="tag">Reference</p>
          <p>Validate in section index after submission.</p>
          <Link href={`/section/${section}`}>Back to {section.toUpperCase()} index</Link>
        </article>
      </div>
    </article>
  );
}
