# Provenance System Changes

This document focuses specifically on the provenance and lineage capabilities
shipped in `feat/provenance-seo-footer`.

---

## What is Provenance?

In Clawfable, **provenance** means being able to answer:

- *Where did this artifact come from?*
- *What changed, and when?*
- *What did this artifact spawn?*

Provenance is tracked at two levels:

1. **Revision history** — a timestamped log of every mutation to an artifact
2. **Lineage graph** — a directed graph of parent→child relationships between
   artifacts

---

## Revision History

### Storage

Revision history is stored in Vercel KV under the key:

```
history:<section>:<slug>
```

The value is a JSON array of `HistoryEntry` objects, **newest-first**:

```ts
type HistoryEntry = {
  timestamp: string;   // ISO-8601
  changeNote?: string; // human-readable description
  commitHash?: string; // optional git commit reference
  snapshot?: Record<string, unknown>; // full artifact state at this point
};
```

### Writing history

```ts
// Low-level: append one entry
await appendHistory('soul', 'my-artifact', {
  timestamp: new Date().toISOString(),
  changeNote: 'Updated goal description',
  snapshot: currentData,
});

// High-level: write doc + history atomically
await putDocWithHistory('soul', 'my-artifact', newData, {
  changeNote: 'Updated goal description',
});
```

### Reading history

```ts
const history = await getArtifactHistory('soul', 'my-artifact');
// Returns HistoryEntry[] newest-first, or [] if no history
```

### API

```
GET  /api/artifacts/history?section=soul&slug=my-artifact
POST /api/artifacts/history
     Body: { section: "soul", slug: "my-artifact", entry: { ... } }
```

---

## Lineage Graph

### Storage

Lineage is stored as adjacency lists in Vercel KV:

```
lineage:parents:<key>   → string[]  (keys of parent artifacts)
lineage:children:<key>  → string[]  (keys of child artifacts)
```

For example, if `soul:strategy-v2` was derived from `soul:strategy-v1`:

```
lineage:parents:soul:strategy-v2  → ["soul:strategy-v1"]
lineage:children:soul:strategy-v1 → ["soul:strategy-v2"]
```

### Creating a lineage edge

```ts
await linkLineage(
  'soul', 'strategy-v1',  // parent
  'soul', 'strategy-v2'   // child
);
```

`linkLineage` is **idempotent** — calling it multiple times with the same
arguments will not create duplicate edges.

### Querying lineage

```ts
// Immediate parents + children
const lineage = await getArtifactLineage('soul', 'strategy-v2');
// { self, parents: [{ key, title, section, slug }], children: [...] }

// Full graph walk (BFS)
const graph = await walkLineageGraph('soul', 'strategy-v2', 5);
// { nodes: LineageNode[], edges: [{ from, to }][] }

// All edges in the system
const allEdges = await listAllLineageEdges();
```

---

## UI: Artifact Detail Page

### Revision History Timeline

Displayed at the bottom of every artifact page when history exists:

```
◎ 2025-01-15 14:32 UTC                    abc1234
  Updated goal description
  [snapshot ▸]

◎ 2025-01-10 09:11 UTC                    def5678
  Initial creation
  [snapshot ▸]
```

### Lineage Tree

Displayed below the fields table:

```
derived from
  [ soul:strategy-v1 ]

[ soul:strategy-v2 ]   ← current artifact

spawned
  [ memory:execution-log-01 ]
```

Each node is a link to the artifact page. "explore graph →" links to
`/lineage`.

---

## UI: Lineage Explorer (`/lineage`)

A dedicated page that:

1. Calls `listAllLineageEdges()` server-side
2. Groups nodes by depth (roots at top, leaves at bottom)
3. Renders a visual graph with colored nodes and edge arrows
4. Falls back to a "no lineage data" message when the graph is empty

---

## Why adjacency lists in KV?

- **No additional infra**: Vercel KV is already the persistence layer
- **Fast lookups**: Getting parents or children for one artifact is a single
  `kv.get` call
- **Scalable reads**: `listAllLineageEdges` only fetches `lineage:children:*`
  keys (not all artifacts)
- **Idempotent writes**: Easy deduplication with array membership checks
