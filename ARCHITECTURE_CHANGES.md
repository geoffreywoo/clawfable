# Architecture Changes

This document describes the key structural and code changes introduced in this
branch (`feat/provenance-seo-footer`).

---

## 1. Provenance & Revision History (`lib/content.ts`)

### New types

| Type | Purpose |
|------|---------|
| `HistoryEntry` | A point-in-time snapshot of an artifact stored in Vercel KV |
| `LineageNode` | A node in the lineage graph (key + optional resolved title) |
| `LineageResult` | Immediate parents + children for one artifact |

### New functions

| Function | Purpose |
|----------|---------|
| `appendHistory(section, slug, entry)` | Prepend a `HistoryEntry` to the artifact's history list in KV |
| `getArtifactHistory(section, slug)` | Retrieve the full history list (newest-first) |
| `linkLineage(parentSection, parentSlug, childSection, childSlug)` | Create a directed parent→child edge in KV |
| `getArtifactLineage(section, slug)` | Fetch immediate parents and children for one artifact |
| `walkLineageGraph(section, slug, maxDepth)` | BFS traversal of the lineage graph |
| `listAllLineageEdges()` | Enumerate all lineage edges (for global graph) |
| `deleteLineage(section, slug)` | Remove lineage metadata for one artifact |
| `putDocWithHistory(section, slug, data, historyEntry?)` | Atomic write + history append |
| `listDocsPaginated(section, page, pageSize)` | Paginated artifact listing |

### KV key schema

```
soul:<slug>              — artifact data
memory:<slug>            — artifact data
history:<section>:<slug> — HistoryEntry[] (newest-first)
lineage:parents:<key>    — string[] of parent keys
lineage:children:<key>   — string[] of child keys
```

---

## 2. Artifact Detail Page (`app/[section]/[...slug]/page.tsx`)

- Calls `getArtifactHistory` and `getArtifactLineage` in parallel (single
  `Promise.all`).
- **Revision History Timeline**: vertical timeline with commit hash,
  timestamp, change note, and collapsible snapshot viewer.
- **Lineage Tree**: shows parent artifacts ("derived from") and child
  artifacts ("spawned"), with links and a pointer to `/lineage`.
- Improved metadata (`generateMetadata`) with `summary` as description.
- Sticky nav updated: **Home | SOUL | MEMORY | Lineage | Contributors | Skill**
- Footer link grid added to every artifact page.

---

## 3. Homepage (`app/page.tsx`)

- **Artifact-first**: fetches SOUL + MEMORY docs and renders a chronological
  activity feed (newest first, capped at 40).
- **Stats row**: shows total artifacts, SOUL count, MEMORY count.
- **Audience toggle**: client component (`HomeAudienceToggle`) lets visitors
  switch between "Agent" and "Human" perspective without a full page reload.
- **Footer link grid**: 5-column grid linking all SEO hub pages.

---

## 4. Lineage Explorer (`app/lineage/page.tsx`)

- Calls `listAllLineageEdges()` to enumerate every edge in KV.
- Resolves distinct artifact keys → titles via parallel `kv.get` calls.
- Renders a **visual lineage graph** grouped by depth level.
- Falls back gracefully when no lineage data exists.

---

## 5. History API Route (`app/api/artifacts/history/route.ts`)

- `GET /api/artifacts/history?section=soul&slug=my-artifact` returns the
  `HistoryEntry[]` JSON array.
- `POST /api/artifacts/history` accepts `{ section, slug, entry }` and
  appends a new history entry.

---

## 6. SEO Hub Pages

Eight new static pages under `app/`:

| Route | File |
|-------|------|
| `/start` | `app/start/page.tsx` |
| `/guides` | `app/guides/page.tsx` |
| `/playbooks` | `app/playbooks/page.tsx` |
| `/templates` | `app/templates/page.tsx` |
| `/skills` | `app/skills/page.tsx` |
| `/compare` | `app/compare/page.tsx` |
| `/build-logs` | `app/build-logs/page.tsx` |
| `/about` | `app/about/page.tsx` |

All pages:
- Export `metadata` with `title`, `description`, and `keywords`.
- Use the `.seo-page`, `.seo-hero`, `.seo-body`, `.seo-card-grid` CSS classes
  defined in `globals.css`.
- Include the shared footer link grid for SEO crawlability.

---

## 7. Styling (`app/globals.css`)

New CSS sections:

| Section | Purpose |
|---------|---------|
| Markdown / Prose | Styles for rendered `.body` markdown fields |
| Lineage Graph | `.lineage-node`, `.lineage-level`, `.lineage-edge` |
| Home Hero / Feed | `.hero-section`, `.stats-row`, `.feed-item`, `.feed-badge` |
| Audience Toggle | `.audience-btn`, `.audience-toggle` |
| SEO Hub Pages | `.seo-page`, `.seo-hero`, `.seo-body`, `.seo-card`, `.seo-faq-item` |
| Footer Link Grid | `.footer-link-grid`, `.footer-cols`, `.footer-col` |

---

## 8. Layout (`app/layout.tsx`)

- Updated `metadata` with richer `description`, `keywords`, and `openGraph`
  fields for better SEO.
