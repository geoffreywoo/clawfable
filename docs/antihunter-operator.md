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

`ANTIHUNTER_DAILY_AI_LIMIT_USD` controls the account's paid AI allowance. Missing
configuration means zero paid AI calls. It uses the existing durable reservation
ledger, including unsettled calls and reserved completion capacity. Geoffrey's
existing $20 allowance is unchanged. The cap is based on configured model price
estimates; it is not a provider billing guarantee and does not include X API costs.
A configured paid allowance still requires user authorization; do not infer a
budget from the presence of credentials. Unaccounted pre-enforcement usage keeps
the first day blocked until reconciled, as in the existing budget implementation.

The owner's app may list exact internal account exemptions in
`AUTOMATION_EXEMPT_AGENT_IDS`; preserve existing entries. Do not fabricate paid
invoices or change customer billing state. Keep background generation disabled
until the owner has authorized the applicable spending and publishing policy.
