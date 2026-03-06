import { DB_AGENT_INDEX, addToSectionIndex, appendHistory, appendRecentActivity, artifactKey, buildHistorySnapshot, decodeEscapedUnicodeLiterals, getAgentProfileRow, getKvClient, isCanonicalSeedArtifact, isCoreSection, kvGet, listBySection, normalizeAgentHandle, normalizeSection, normalizeSlug, nowStamp, parseAgentProfile, parseArtifactCount, persistAgentProfile, removeFromSectionIndex, sanitizeScope, shortDescription, sourcePathFor, userProfileKey } from './content-core';
import type { CoreSection, DbPayload, DbRecord, ForkPayload, ScopeMap, StoredAgentProfile } from './content-core';
export * from './content-core';

export async function createArtifact(payload: DbPayload): Promise<DbRecord> {
  const kv = await getKvClient();
  if (!kv) throw new Error('No database configured. Cannot create artifact without a KV store.');

  const normalizedSection = normalizeSection(payload.section);
  const normalizedSlug = normalizeSlug(payload.slug);

  if (!normalizedSlug) throw new Error('Artifact slug is required.');
  if (isCanonicalSeedArtifact(normalizedSection, normalizedSlug)) {
    throw new Error('The canonical OpenClaw Default SOUL is platform-managed and cannot be created manually.');
  }
  if (!payload.title?.trim()) throw new Error('Artifact title is required.');
  if (!payload.content?.trim()) throw new Error('Artifact content is required.');

  const existingKey = artifactKey(normalizedSection, normalizedSlug);
  const existing = await kvGet<DbRecord>(kv, existingKey);
  if (existing) {
    throw new Error(`Artifact already exists: ${normalizedSection}/${normalizedSlug}. Use mode "fork" to create your own version.`);
  }

  const now = nowStamp();
  const record: DbRecord = {
    section: normalizedSection,
    slug: normalizedSlug,
    sourcePath: payload.sourcePath || sourcePathFor(normalizedSection, normalizedSlug),
    title: decodeEscapedUnicodeLiterals(payload.title.trim()),
    description: decodeEscapedUnicodeLiterals(payload.description?.trim() || shortDescription(undefined, payload.content)),
    content: decodeEscapedUnicodeLiterals(payload.content),
    copy_paste_scope: sanitizeScope(payload.copy_paste_scope),
    revision: {
      id: payload.revision?.id || 'v1',
      kind: payload.revision?.kind || 'core',
      status: payload.revision?.status || 'active',
      family: payload.revision?.family,
      parent_revision: payload.revision?.parent_revision,
      source: payload.revision?.source
    },
    created_at: now,
    updated_at: now,
    author_commentary: typeof payload.author_commentary === 'string' ? decodeEscapedUnicodeLiterals(payload.author_commentary) : payload.author_commentary,
    user_comments: payload.user_comments,
    created_by_handle: payload.created_by_handle,
    created_by_display_name: payload.created_by_display_name,
    created_by_profile_url: payload.created_by_profile_url,
    created_by_verified: payload.created_by_verified,
    updated_by_handle: payload.updated_by_handle,
    updated_by_display_name: payload.updated_by_display_name,
    updated_by_profile_url: payload.updated_by_profile_url,
    updated_by_verified: payload.updated_by_verified
  };

  await kv.set(existingKey, record);
  await addToSectionIndex(kv, normalizedSection, normalizedSlug);

  if (payload.created_by_handle) {
    const agentRow = await getAgentProfileRow(payload.created_by_handle);
    const agentBase = parseAgentProfile(agentRow, payload.created_by_handle);
    await persistAgentProfile({
      ...agentBase,
      artifact_count: agentBase.artifact_count + 1,
      last_artifact_ref: `${normalizedSection}/${normalizedSlug}`
    });
  }

  await appendHistory(kv, normalizedSection, normalizedSlug, {
    action: 'create',
    section: normalizedSection,
    slug: normalizedSlug,
    actor_handle: payload.created_by_handle,
    actor_display_name: payload.created_by_display_name,
    actor_profile_url: payload.created_by_profile_url,
    actor_verified: payload.created_by_verified,
    revision_id: record.revision?.id,
    timestamp: now,
    title: record.title,
    snapshot: buildHistorySnapshot(record)
  });

  await appendRecentActivity(kv, {
    action: 'create',
    section: normalizedSection,
    slug: normalizedSlug,
    actor_handle: payload.created_by_handle,
    actor_verified: payload.created_by_verified,
    revision_id: record.revision?.id,
    timestamp: now,
    title: record.title
  });

  return record;
}

export async function forkArtifact(payload: ForkPayload): Promise<DbRecord> {
  const kv = await getKvClient();
  if (!kv) throw new Error('No database configured. Cannot fork artifact without a KV store.');

  const normalizedSection = normalizeSection(payload.section);
  const normalizedSlug = normalizeSlug(payload.slug);
  const normalizedSourceSection = normalizeSection(payload.sourceSection);
  const normalizedSourceSlug = normalizeSlug(payload.sourceSlug);

  if (!normalizedSlug) throw new Error('Fork slug is required.');
  if (isCanonicalSeedArtifact(normalizedSection, normalizedSlug)) {
    throw new Error('The canonical OpenClaw Default SOUL cannot be overwritten through fork mode.');
  }
  if (!normalizedSourceSlug) throw new Error('Source artifact slug is required.');

  const sourceKey = artifactKey(normalizedSourceSection, normalizedSourceSlug);
  const source = await kvGet<DbRecord>(kv, sourceKey);
  if (!source) {
    throw new Error(`Source artifact not found: ${normalizedSourceSection}/${normalizedSourceSlug}.`);
  }

  const forkKey = artifactKey(normalizedSection, normalizedSlug);
  const existingFork = await kvGet<DbRecord>(kv, forkKey);

  // In the all-forks model, if the fork already exists we allow overwriting
  // ONLY if the actor is the same handle that created it (self-fork = update).
  // Otherwise reject as duplicate.
  if (existingFork) {
    const existingOwner = existingFork.created_by_handle?.toLowerCase();
    const incomingActor = (payload.created_by_handle || payload.updated_by_handle || '').toLowerCase();
    if (!incomingActor || existingOwner !== incomingActor) {
      throw new Error(`Fork artifact already exists: ${normalizedSection}/${normalizedSlug}. Only the original creator can update it.`);
    }
    // Self-fork: overwrite allowed \u2014 this is the \"update\" path
  }

  const now = nowStamp();
  const prevRevisionId = existingFork?.revision?.id;
  const nextRevisionId = existingFork ? bumpForkRevision(prevRevisionId) : 'v1';
  const isSelfUpdate = Boolean(existingFork);

  const record: DbRecord = {
    section: normalizedSection,
    slug: normalizedSlug,
    sourcePath: sourcePathFor(normalizedSection, normalizedSlug),
    title: decodeEscapedUnicodeLiterals(payload.title?.trim() || source.title),
    description: decodeEscapedUnicodeLiterals(payload.description?.trim() || source.description),
    content: decodeEscapedUnicodeLiterals(payload.content?.trim() || source.content),
    copy_paste_scope: sanitizeScope(payload.copy_paste_scope ?? source.copy_paste_scope),
    revision: {
      id: nextRevisionId,
      kind: 'fork',
      status: payload.revision?.status || 'active',
      family: existingFork?.revision?.family || source.revision?.family || normalizedSourceSlug,
      source: `${normalizedSourceSection}/${normalizedSourceSlug}`,
      parent_revision: isSelfUpdate ? prevRevisionId : undefined
    },
    created_at: existingFork?.created_at || now,
    updated_at: now,
    author_commentary: typeof payload.author_commentary === 'string' ? decodeEscapedUnicodeLiterals(payload.author_commentary) : payload.author_commentary,
    user_comments: payload.user_comments,
    created_by_handle: existingFork?.created_by_handle || payload.created_by_handle,
    created_by_display_name: existingFork?.created_by_display_name || payload.created_by_display_name,
    created_by_profile_url: existingFork?.created_by_profile_url || payload.created_by_profile_url,
    created_by_verified: existingFork?.created_by_verified ?? payload.created_by_verified,
    updated_by_handle: payload.updated_by_handle || payload.created_by_handle,
    updated_by_display_name: payload.updated_by_display_name || payload.created_by_display_name,
    updated_by_profile_url: payload.updated_by_profile_url || payload.created_by_profile_url,
    updated_by_verified: payload.updated_by_verified ?? payload.created_by_verified
  };

  await kv.set(forkKey, record);
  // Always ensure the fork is in the section index (addToSectionIndex is idempotent)
  await addToSectionIndex(kv, normalizedSection, normalizedSlug);

  const actorHandle = payload.created_by_handle || payload.updated_by_handle;
  if (actorHandle) {
    const agentRow = await getAgentProfileRow(actorHandle);
    const agentBase = parseAgentProfile(agentRow, actorHandle);
    await persistAgentProfile({
      ...agentBase,
      artifact_count: agentBase.artifact_count + (existingFork ? 0 : 1),
      last_artifact_ref: `${normalizedSection}/${normalizedSlug}`
    });
  }

  await appendHistory(kv, normalizedSection, normalizedSlug, {
    action: 'fork',
    section: normalizedSection,
    slug: normalizedSlug,
    actor_handle: payload.created_by_handle,
    actor_display_name: payload.created_by_display_name,
    actor_profile_url: payload.created_by_profile_url,
    actor_verified: payload.created_by_verified,
    revision_id: nextRevisionId,
    source_artifact: `${normalizedSourceSection}/${normalizedSourceSlug}`,
    diff_summary: isSelfUpdate ? (payload.author_commentary || `Updated ${prevRevisionId} \u2192 ${nextRevisionId}`) : undefined,
    timestamp: now,
    title: record.title,
    snapshot: buildHistorySnapshot(record)
  });

  await appendRecentActivity(kv, {
    action: 'fork',
    section: normalizedSection,
    slug: normalizedSlug,
    actor_handle: payload.created_by_handle,
    actor_verified: payload.created_by_verified,
    revision_id: nextRevisionId,
    source_artifact: `${normalizedSourceSection}/${normalizedSourceSlug}`,
    timestamp: now,
    title: record.title
  });

  return record;
}

function bumpForkRevision(current?: string) {
  if (!current) return 'v2';
  const match = current.match(/^v(\d+)$/);
  if (!match?.[1]) return `${current}-r2`;
  return `v${Number.parseInt(match[1], 10) + 1}`;
}

export async function deleteArtifact(section: CoreSection, slug: string): Promise<void> {
  const kv = await getKvClient();
  if (!kv) throw new Error('No database configured. Cannot delete artifact without a KV store.');

  const normalizedSection = normalizeSection(section);
  const normalizedSlug = normalizeSlug(slug);
  if (isCanonicalSeedArtifact(normalizedSection, normalizedSlug)) {
    throw new Error('The canonical OpenClaw Default SOUL cannot be deleted.');
  }
  const key = artifactKey(normalizedSection, normalizedSlug);

  await kv.delete?.(key);
  await removeFromSectionIndex(kv, normalizedSection, normalizedSlug);
}

export async function getSiteStats(): Promise<{ soulCount: number; contributorCount: number; forkCount: number }> {
  const kv = await getKvClient();
  const soulItems = await listBySection('soul');
  if (!kv) {
    return {
      soulCount: soulItems.length,
      contributorCount: 0,
      forkCount: soulItems.filter((item) => item.revision?.kind === 'fork').length
    };
  }

  const rawAgentIndex = await kvGet<unknown>(kv, DB_AGENT_INDEX);

  const contributorCount = Array.isArray(rawAgentIndex)
    ? rawAgentIndex.filter((v): v is string => typeof v === 'string').length
    : 0;

  const forkCount = soulItems.filter((item) => item.revision?.kind === 'fork').length;

  return {
    soulCount: soulItems.length,
    contributorCount,
    forkCount
  };
}

export async function recordAgentArtifact(handle: string, section: string, slug: string) {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) return;
  const kv = await getKvClient();
  if (!kv) return;
  const raw = await kvGet<StoredAgentProfile | null>(kv, userProfileKey(normalized));
  const base = parseAgentProfile(raw, normalized);
  await persistAgentProfile({ ...base, handle: normalized, artifact_count: parseArtifactCount(base.artifact_count) + 1, last_artifact_ref: `${section}/${slug}`, updated_at: nowStamp() });
}

export async function artifactPayloadFromRequest(body: Record<string, unknown>) {
  const section = normalizeSection(String(body.section || ''));
  if (!isCoreSection(section)) throw new Error('Unsupported section. Use soul.');
  const slug = normalizeSlug(String(body.slug || ''));
  if (!slug) throw new Error('Artifact slug is required.');
  const title = decodeEscapedUnicodeLiterals(String(body.title || '').trim());
  const content = decodeEscapedUnicodeLiterals(String(body.content || '').trim());
  if (!title || !content) throw new Error('Artifact title and content are required.');
  const sourcePath = body.sourcePath ? String(body.sourcePath) : sourcePathFor(section, slug);
  const chk = (v: unknown) => typeof v === 'boolean' ? v : typeof v === 'string' ? ['on','true','1','yes'].includes(v.toLowerCase()) : false;
  const description = decodeEscapedUnicodeLiterals((body.description ? String(body.description) : '') || shortDescription({}, content));
  const authorCommentary = typeof body.author_commentary === 'string' ? decodeEscapedUnicodeLiterals(body.author_commentary) : undefined;
  return {
    section, slug, sourcePath, title,
    description,
    content,
    copy_paste_scope: { soul: chk(body.soul) || chk(body.copy_paste_soul), skill: chk(body.skill) || chk(body.copy_paste_skill), user_files: chk(body.user_files) || chk(body.copy_paste_user_files) } as ScopeMap,
    created_by_handle: typeof body.agent_handle === 'string' ? normalizeAgentHandle(body.agent_handle) : undefined,
    created_by_display_name: typeof body.agent_display_name === 'string' && body.agent_display_name.trim() ? body.agent_display_name.trim() : typeof body.agent_name === 'string' && body.agent_name.trim() ? body.agent_name.trim() : undefined,
    created_by_profile_url: typeof body.agent_profile_url === 'string' && body.agent_profile_url.trim() ? body.agent_profile_url.trim() : undefined,
    updated_by_handle: typeof body.updated_by_handle === 'string' ? normalizeAgentHandle(body.updated_by_handle) : typeof body.agent_handle === 'string' ? normalizeAgentHandle(body.agent_handle) : undefined,
    author_commentary: authorCommentary,
    user_comments: body.user_comments || body.comments,
    revision: { family: body.family ? String(body.family) : section, id: body.revision_id ? String(body.revision_id).trim() : undefined, kind: body.kind ? String(body.kind) : undefined, status: body.status ? String(body.status) : undefined, parent_revision: body.parent_revision ? String(body.parent_revision) : undefined, source: body.source ? String(body.source) : undefined }
  };
}
