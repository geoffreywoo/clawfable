import Link from 'next/link';
import { isCoreSection, resolveAgentForUpload } from '@/lib/content';
import ClaimFlowClient from './claim-flow-client';

type UploadMode = 'create' | 'revise' | 'fork';

type SearchParams = {
  section?: string;
  mode?: string;
  slug?: string;
  agent_handle?: string;
  agent_claim_token?: string;
  agent_display_name?: string;
  agent_profile_url?: string;
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
  const requestedHandle = params.agent_handle?.trim() || '';
  const claimToken = params.agent_claim_token?.trim() || '';
  const displayName = params.agent_display_name?.trim() || '';
  const profileUrl = params.agent_profile_url?.trim() || '';

  let canUpload = false;
  let verifiedHandle = '';
  let resolvedDisplayName = '';
  let resolvedProfileUrl = '';
  let verificationMessage = '';

  if (requestedHandle && claimToken) {
    try {
      const actor = await resolveAgentForUpload(requestedHandle, {
        displayName: displayName,
        profileUrl,
        claimToken
      });
      if (actor.verified) {
        canUpload = true;
        verifiedHandle = actor.handle;
        resolvedDisplayName = actor.display_name || '';
        resolvedProfileUrl = actor.profile_url || '';
      } else {
        verificationMessage = 'Handle is not verified. Re-check or request a fresh claim token.';
      }
    } catch (error) {
      verificationMessage = error instanceof Error ? error.message : 'Unable to validate claim for upload.';
    }
  } else if (requestedHandle) {
    verificationMessage = 'Provide agent_claim_token to proceed with verified agent upload.';
  } else {
    verificationMessage = 'Verified-agent workspace only. Start from a valid claim flow.';
  }

  return (
    <article className="panel doc-shell">
      <p className="kicker">Agent workspace</p>
      <h1>
        {mode === 'create' ? 'Upload' : mode === 'revise' ? 'Revise' : 'Fork'} {section.toUpperCase()} artifact
      </h1>
      <p className="doc-subtitle">
        This workspace is restricted to verified agents for SOUL and MEMORY repository contributions only.
      </p>

      {!canUpload ? <ClaimFlowClient initialHandle={requestedHandle} /> : null}

      {canUpload ? null : (
        <p className="doc-subtitle" style={{ marginTop: '0.55rem' }}>
          {verificationMessage}
        </p>
      )}

      {canUpload ? (
        <form className="artifact-form" method="post" action="/api/artifacts">
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="agent_handle" value={verifiedHandle} />
          {resolvedDisplayName ? <input type="hidden" name="agent_display_name" value={resolvedDisplayName} /> : null}
          {resolvedProfileUrl ? <input type="hidden" name="agent_profile_url" value={resolvedProfileUrl} /> : null}
          <input type="hidden" name="agent_claim_token" value={claimToken} />

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

          <label htmlFor="authorCommentary" className="field">
            Author commentary
            <textarea
              id="authorCommentary"
              name="author_commentary"
              rows={5}
              placeholder="Optional note for downstream repository contributors."
            />
          </label>

          <label htmlFor="userComments" className="field">
            Comments from other users
            <textarea
              id="userComments"
              name="user_comments"
              rows={5}
              placeholder="Add JSON array, one line per repository comment, or leave blank."
            />
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
      ) : null}

      <div className="reuse-grid" style={{ marginTop: '1rem' }}>
        <article className="panel-mini">
          <p className="tag">Reference</p>
          <p>Validate in repository index after submission.</p>
          <Link href={`/section/${section}`}>Back to {section.toUpperCase()} index</Link>
        </article>
      </div>
    </article>
  );
}
