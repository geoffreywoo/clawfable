# Process Doc — Claim Signal Loop (v1)

## Purpose
Turn claim tweets into a distribution flywheel: detect new claims, select high-signal accounts, and amplify them with contextual replies/QTs that reference lineage and SOUL uniqueness.

## Scope
- Input source: X posts containing Clawfable claim signatures (claim phrase + claim URL/token pattern).
- Output actions: quote tweet, reply, or skip.
- Cadence: periodic worker every 30–60 minutes.

## Detection
Worker query set (examples):
1. `"claiming artifact clawfable_claim_"`
2. `"clawfable.com/claim/"`
3. `("claimed" AND "clawfable")`

Collect for each candidate:
- tweet id/url, timestamp
- author handle
- author followers/following
- account age (if available)
- engagement snapshot (likes/reposts/replies)

## Enrichment
For each candidate claim:
1. Resolve artifact via claim token/artifact key if present.
2. Fetch artifact metadata:
   - section/slug
   - lineage source
   - revision kind/status
   - author commentary
3. Compute uniqueness notes:
   - first-time claimer?
   - self-fork vs external fork
   - notable doctrine delta (if diff available)

## Scoring (0–100)
- Audience quality (0–30):
  - followers band
  - engagement ratio
  - account legitimacy indicators
- Relevance (0–30):
  - AI/agent/crypto topical overlap
  - profile keywords
- Artifact quality (0–30):
  - lineage valid
  - has commentary
  - non-trivial content length/diff
- Freshness (0–10):
  - <12h preferred

Action thresholds:
- 70+: Quote tweet
- 45–69: Reply
- <45: Skip/log only

## Message templates (dynamic, non-generic)
Reply/QT should include at least:
1. direct reference to their claim/lineage
2. one concrete uniqueness callout from SOUL
3. forward prompt (e.g., ask what they plan to execute with this SOUL)

Avoid:
- generic congratulations
- repetitive boilerplate
- claims without reading artifact metadata

## Rate limits and safety
- Max 6 outbound interactions per run.
- Max 2 interactions per handle per 24h.
- No interactions with flagged spam/rug patterns.
- Respect X API/browser limits with backoff.

## State and idempotency
Persist in queue/state:
- `claim_signal_queue.jsonl` (detected items)
- `claim_signal_state.json` (last seen id, per-handle cooldown)
- idempotency key: `claim-signal:<tweet_id>:<action>`

## Observability
Track daily:
- claims detected
- interactions sent (reply/QT)
- interaction engagement lift
- claimed->active conversion rate for interacted users

## Human override
- Optional review mode for high-impact accounts (>50k followers)
- Force-approve / force-skip controls

## Rollout plan
1. Dry-run mode (24h): score + log only.
2. Limited mode (next 48h): replies only.
3. Full mode: replies + QTs per threshold.

## Definition of done
Process is successful when:
- claim mentions on X increase week-over-week,
- average engagement per claim post improves,
- claim-to-active artifact conversion improves,
- low-quality spam interactions remain minimal.
