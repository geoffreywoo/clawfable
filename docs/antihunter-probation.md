# Frozen Probation v1 runner

This CLI executes only the published synthetic invoice extraction protocol at
https://antihunter.com/experiments/probation-v1/manifest.json. It has no X writer.
The manifest, each local/live artifact, and the three shared AI source files are
SHA-256 pinned. Runner source hashes are stored with the first claim and exported;
changing the runner after starting requires a separate, publicly versioned trial.

From this checkout, using the existing private account environment:

```sh
node --env-file=/Users/gwbox2/.config/antihunter/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-probation.ts preflight
node --env-file=/Users/gwbox2/.config/antihunter/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-probation.ts report --output /absolute/new-report.json
node --env-file=/Users/gwbox2/.config/antihunter/clawfable.production.env node_modules/tsx/dist/cli.mjs scripts/operator-probation.ts run --output /absolute/new-results.json
```

`preflight` and `report` perform reads only. **`run` makes paid AI calls.** The
wrapper starts a dedicated production child with `AI_MODEL_POLICY=standard` before
importing the shared client; saved environment and other account settings stay
unchanged. Only account 5 is used. Each call has the same $3 run/campaign context,
one Anthropic model, no fallback, no retries, and only the frozen synthetic input.

State lives at account 5's `operator-growth-v1:probation-v1` operational namespace.
An atomic, durable slot claim is also an exclusive dispatch lock. Another process
cannot advance past an unresolved claim, and claims never expire or get retried.
Completed slots resume only after matching their unique ledger receipts. Any
error, missing usage, mismatch, budget denial or uncertain write stops execution.
No command clears state or spending holds. A crash may leave an unrepeatable slot.

Twenty calls are a target. Full worst-case reservations total $5.26240; sequential
settlement may allow twenty calls inside the fixed $3 admission budget. Unresolved
charges remain committed, and this is an estimate rather than an invoice guarantee.
Incomplete or financially unresolved runs have no winner. Human review remains
unmeasured. Public exports are allowlisted synthetic outputs, frozen scorer
decisions, model/control metadata and selected spending receipts. Raw SDK errors,
headers, secrets and unrelated account records are never exported.

The unchanged shared client does not return raw text or actual returned model on
some thrown incomplete/empty responses. Those fields remain null; exact matching
ledger costs are retained and the run stops. A ledger's recorded model alone is
not proof of the provider-returned identity.

Run offline checks with `npx vitest run test/antihunter-probation.test.ts`.
The checked-in public fixture bundle is hash-identical to the frozen manifest.
