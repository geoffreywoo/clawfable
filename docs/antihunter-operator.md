# Anti Hunter operator

Clawfable is the publishing and learning system for @AntiHunterAI. The local
Codex operator researches and composes copy, then calls the same posting service
as the web app. Its credentials, drafts, publication logs, learning signals, and
performance history remain in Clawfable. There is no separate X client here.

The CLI is deliberately bound to Clawfable agent `5`, X user
`2019634783962226688`, and handle `antihunterai`. It checks the persisted owner,
requires the existing automation entitlement, and verifies identity with X
before drafting, posting, or reading metrics. It cannot operate Geoffrey's account.

Run from this repository with existing production configuration stored outside
Git in a mode-600 file:

```sh
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts inspect
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts draft --file /absolute/path/to/reviewed-draft.json
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts publish --tweet-id LOCAL_DRAFT_ID
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts verify --tweet-id LOCAL_DRAFT_ID
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts metrics
```

A draft JSON contains `content`, `topic`, `sources` (nonempty array of source
references), and optionally `thesis`. The operator must actually verify those
sources and review the copy before dispatch; the CLI does not certify evidence.
Externally composed drafts are marked `operator_written` with an explicit Codex
operator rationale, never represented as human-authored examples or fabricated
V2 generations. Exact duplicate drafts reuse the existing record.

Publishing is limited to four originals per rolling day and at least six hours
between originals. It persists a dispatch marker before calling the shared
posting service. A pending/uncertain/failed dispatch cannot be blindly retried;
reconcile the X account and Clawfable receipts first. The verify command reopens
the exact X post via the official API and checks its author, content, and stored
learning signal. Existing reply emergency protections remain in effect.

The authorized normal allocation is **$30/Pacific day**: AI $24, X $4, analytics
$1 soft target, contingency $1. A same-day recorded exception permits **$50**:
AI $38, X $7, analytics $1, contingency $4. Set
`ANTIHUNTER_DAILY_AI_LIMIT_USD=24` to activate this authorized policy; code admits
$24 normally and $38 only with a current-Pacific-day surge decision. Values
at least $24 select this policy rather than raising its limits. A configured
value below $24 stays binding, and missing/zero configuration disables paid AI.
The existing account-5 AI ledger retains unsettled calls and completion holds;
Geoffrey's $20 allowance and ledger are unchanged. These are provider-price
estimates, not an invoice guarantee. The operator does not buy credits or add
subscriptions. Paid image generation must also use this AI ledger; no separate
unmetered image provider is implemented. Use rendered local images meanwhile.

Every official X request made in the operator scope reserves its bounded cost
before dispatch. Unknown endpoints, unpriced uploads, altered credentials, or
unbounded reads fail closed. All originals conservatively reserve the URL-post
rate ($0.20), including bare domains. Successful reads settle estimated resource
counts; failed/uncertain requests retain the full reservation. No discount for
owned reads or deduplication is assumed. Publication reserves its author/text/
attachment verification first. Background metrics and research each claim a
six-hour interval atomically, including failed runs; stored reports are free of
X requests. Thirty-minute wakes do not increase publishing or read limits.

The `budget` and `report` commands are read-only. Additional JSON-file commands:

```sh
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts campaign --file campaign.json
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts surge --file surge.json
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts analytics-observation --file observation.json
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts contribution --file contribution.json
```

- Campaign: `{campaignId, episodeId, hypothesis, audience, landingPath, primaryMetric}`.
  IDs use lowercase letters/digits/hyphens; the landing path is local to
  antihunter.com. Include the same object under `campaign` in a draft JSON.
  Episodes are immutable hypotheses; register a new episode for a changed test.
- Surge: `{reason, expectedBenefit, boundedExperiment}`. Expires at Pacific
  midnight; a wake is not a reason to spend the allowance.
- Analytics: `{day, observedAt, spendUsd, events, source, campaigns?}`. Day is
  `YYYY-MM-DD` Pacific; spend and event counts are cumulative for that day.
  Optional campaign rows contain `campaignId`, `episodeId`, `experience_view`,
  `experience_complete`, `share_intent`, and `token_info_view` counts. Observations
  are timestamped, not added twice. Known spend cannot be reduced by a later
  lower estimate. Missing values are unknown rather than fabricated zeroes.
- Contribution: `{campaignId, episodeId, xPostId, xAuthorId, sourceUrl, observedAt,
  assessment}`. First review the actual external post and author. Record why it
  is an eligible contribution; a bare mention is insufficient. Exact X post IDs
  deduplicate receipts. Reports show unknown counts until receipts exist.

All new state lives in account 5's `operator-growth-v1` namespace. Campaign
metadata and reviewed asset hashes also live in each draft's `sourceBrief`;
operator drafts never acquire fabricated V2 generation or experiment lineage.
The public GET `/api/public/antihunter/analytics-control` exposes only
`{day,sampleRate,expiresAt}`, allows antihunter.com origins, and caches for 60s.
Sampling is 1 below $0.50, 0.1 from $0.50, and 0 from $0.80. Missing/stale
observations disable collection; observations expire after 90 minutes. This
limits ordinary collection but is not a guaranteed billing cap under abuse or
delayed provider reporting. Known analytics overage consumes contingency first,
then reduces discretionary AI allowance.

## Reviewed native image publishing

Draft JSON may include `media: {path, altText}` for one PNG/JPEG, at most 5 MiB.
The image's hash, type, byte count and alt text are frozen with the draft.
Upload uses official v2 endpoints with the existing OAuth1 client; supported
authentication is documented in `https://api.x.com/2/openapi.json`.

Before an actual upload, independently verify its current price and entitlement.
`media-pricing --file pricing.json` accepts `{uploadUsd,source,checkedAt}` with an
official X source and a current-Pacific-day timestamp. Absence fails closed; do
not infer a free upload from its omission on the pricing page. Then:

```sh
node --env-file=/absolute/path/to/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-antihunter.ts upload --tweet-id LOCAL_DRAFT_ID --file /absolute/image.png
```

Confirmed upload/media-key/expiry/alt-text receipts precede publication.
Repeated upload commands reuse the receipt. Metadata failure resumes only the
known media ID; unknown upload outcomes block retries. A proven expired upload
can be replaced while preserving its prior receipt. `publish` immediately
verifies the official author, URL-expanded text, media key, and shared learning
receipt. Text-only posts remain available when upload access/pricing is unknown.

For a known X post with uncertain local persistence, use
`reconcile --tweet-id LOCAL_DRAFT_ID --x-tweet-id CONFIRMED_X_ID`. It checks the
actual post and dispatch window before repairing shared receipts; it never
posts again. `publish --retry-rejected` is limited to a recorded local rejection
where no X post request was dispatched. Legacy dispatch markers still block
blind retries. Existing reply emergency protections remain in force.

The owner's app may list exact internal account exemptions in
`AUTOMATION_EXEMPT_AGENT_IDS`; preserve existing entries. Do not fabricate paid
invoices or change customer billing state. Keep background generation disabled
until the owner has authorized the applicable spending and publishing policy.

Set `CLAWFABLE_OPERATOR_MANAGED_AGENT_IDS=5` in production when the Mini's
Codex schedule owns this account. Both Vercel posting and research cron skip
these exact IDs before doing any per-account work. This prevents a competing
scheduler and unbudgeted background API reads. The operator explicitly calls
metrics through Clawfable at its own bounded cadence. Other IDs are unaffected.
