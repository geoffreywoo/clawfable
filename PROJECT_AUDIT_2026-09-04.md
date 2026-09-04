# Clawfable creative learning audit and Astra rollout

Implementation base: `41b5c5d8f59fe4e90063dd421d50033beac39eb5` (current production/main at inspection). The prior local baseline was 1,235 passing tests; this work starts from newer main and preserves its CI, reward-confidence, and anti-slop changes.

## Confirmed findings and repairs

| Finding / reproduction | Repair | Regression evidence |
| --- | --- | --- |
| Positive feedback was included among negative preference instructions. An approval could teach the system to avoid the approved style. | Separate feedback polarity throughout derived memory and reject inferred removal assumptions. | `learning-loop.test.ts`, `learning-evidence.test.ts` |
| Queue edits, manual-post children, and calibration stored inconsistent or truncated edit context. | Shared complete before/after metadata, transformation lessons, parent-child lineage; retrieve at most two complete relevant approved pairs, excluding superseded/rejected revisions. | `learning-loop.test.ts`, `queue-ownership.test.ts`, `calibration-route.test.ts`, `draft-lineage.test.ts` |
| Early performance checkpoints counted toward final rewards and training baselines. | Require finite measurement timestamps at least 18 hours after posting for final performance learning. Explicit feedback remains immediate; early velocity remains descriptive. | `outcome-rewards.test.ts`, `bandit.test.ts`, `performance-learning.test.ts`, `performance-tracking.test.ts` |
| Timeline omission was interpreted as removal and negative editorial intent. Missing replies and provider trouble could therefore poison preferences. | Official per-ID lookup returns present/not_found/unavailable. Require two explicit not-found observations at least 15 minutes apart. Unavailable observations do not confirm removal; presence resets the count. Confirmed removal has unknown reason. | `twitter-availability.test.ts`, `x-removal-reconciliation.test.ts`, `soul-evolution.test.ts` |
| Process-local locks did not protect shared array ledgers across Vercel instances. Concurrent read/modify/write updates could discard learning or candidate records. | Redis Lua snapshot/revision compare-and-swap for learning, outcome, generation-outcome, candidate, and run ledgers; stable IDs and idempotent experiment reward projection. Local fallback retains per-key serialization. | `kv-storage-distributed.test.ts`, storage concurrency suites |
| A manual posting request could use tweet state read before acquiring its lock. | Reload fresh state under the lock; recheck ownership, content, parent, type, and lifecycle before an X call. | `twitter-post-route.test.ts` |
| Agent list aggregation could include a recycled-handle account that direct ownership checks denied. | Every listing candidate passes the shared `canAccessAgent` policy used by dashboard and companion access. | `account-access.test.ts` |
| Stripe's reservation was also treated as a completed event. Interrupted processing could acknowledge an unprocessed retry. | Separate short owner lease from durable completion receipt; busy and failed verified events stay retryable. Recover ambiguous lease responses; complete only after processing succeeds. | `stripe-webhook.test.ts`, `kv-storage-distributed.test.ts` |
| Dynamic seed prose lost its qualified evidence when converted into briefs. | Resolve source-document IDs to qualified current story claims; synthesized prose stays inspiration, never evidence. | `generation-creativity.test.ts`, `generation-v2-integration.test.ts` |
| Ideation saw previous drafts inside nested memory sections, encouraging copied premises. Variants lacked distinct editorial jobs. | Strip raw draft prose from ideation while retaining extracted lessons. Astra variants develop a direct judgment, concrete decision, or unexpected consequence from the same permitted evidence. Writers and judges receive approved edit pairs. | `generation-creativity.test.ts` |
| Exploration labels did not implement the configured random selection policy. Geoffrey-specific topical rules also leaked to other profiles. | Astra performs at most one exploration choice per batch, among fully eligible near-ties within 0.03 quality-margin points of the best feasible choice. Store eligible IDs and propensity. Geoffrey's restrictions and allocation apply only to Geoffrey. | `generation-creativity.test.ts`, `generation-v2.test.ts` |
| Provider routing had no Astra capability definition or controlled account rollout. Partial response text could be accepted after truncation. | Separate `publishing_v2_astra` stack, account rollout switch, explicit reasoning compatibility, no sampling parameters, rejection of incomplete outputs, existing bounded deadlines/fallbacks, and requested/actual model provenance. | `ai-routing.test.ts` |

## Model and creative controls

`ASTRA_CREATIVE_ROLLOUT` is `off` by default (absent/invalid values preserve the current stacks). `geoffrey` opts in only the recognized Geoffrey aliases; `all` is reserved for a successful later promotion. All creative stages, replies, editorial judgment, learning, and voice synthesis resolve the account stack. Classification and source-enrichment utilities retain their existing models. Explicit preview comparison stacks remain independent.

Astra defaults to high reasoning for creative work and learning, medium for judges, and at least 8,192 output/reasoning tokens within existing run deadlines. Inherited `none`/`minimal` settings normalize to `low`; supported efforts run through `max`. No `temperature` is sent. Fallbacks use the same downstream eligibility gates. Traces distinguish requested model, actual model, reasoning, skipped/unavailable providers, incomplete responses, tokens, latency, and estimated cost.

Pricing checked against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) on 2026-09-04: Astra standard uncached input $10/M and output $50/M tokens; over 272k input tokens, input is 2x and output 1.5x. Estimates retain cache token counts but use uncached input rates; they are not invoice reconciliation. Capability source: [Astra migration guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra).

## Derived history repair

The protected `POST /api/internal/agents/:id/generation/quality/refresh` accepts `{"mode":"derived_only"}`. It acquires the existing account lock, rebuilds learning summaries, and replays experiment reward projections from retained verified evidence. It does not read X, refill or alter the queue, publish, or rewrite the SOUL. Insight synthesis can call the configured learning model. Raw signals, tweets, feedback, and outcomes remain preserved.

Summary derivation version `learning-2026-09-04-v3` records mature/immature counts, recovered edit signal IDs, excluded unverified removal counts, and reward math version `mature-spread-action-2026-09-04-v1`. Mature action rewards are recalculated from measured metrics and current mature baselines, replacing legacy cached calculations only in derived views/projections. Cron rebuilds stale derivation versions. Recovered examples reach subsequent generation context.

Rebuilds cannot recover records already lost to historical races or retention limits. Complete edit pairs are recoverable only when intact lineage and trustworthy original/edited text still exist. Performance maturity depends on actual measurement time, not the current age of a formerly early checkpoint.

## Evaluation and release gates

The frozen evaluation uses 40 packets: 30 Geoffrey and 10 explicitly synthetic other-account profiles. Both stacks receive identical frozen briefs and evidence. Account reference examples are held out from prompt anchors, with their original authorship provenance retained. A timeline reference is not proof of human composition. Primary model fallback invalidates a comparison as Astra evidence. The evaluation records eligibility, ideas, factual failures, copied premises, estimated edit burden, latency, cost, and blinded preference. A score must identify its reviewers; model votes are not human votes and edit estimates are not observed edits.

Promotion requires at least 30 decisive comparisons, at least 60% Astra preference, all 40 comparisons completed, and no hard-gate regression. Empty or unqualified content does not satisfy the gate. Frozen evidence is as of capture, not a claim of current news accuracy.

Release order:

1. Ship shared correctness and gated Astra support with rollout disabled. Verify the exact Vercel deployment, production aliases, and health commit.
2. Allow older in-flight invocations to drain before replaying projections, because an old deployment does not participate in new CAS revisions.
3. Run the derived-only rebuild and inspect the protected account audit. Preserve raw history and the posting cadence.
4. Validate the production OpenAI credential and actual Astra access, complete the frozen comparison, then enable only `geoffrey` and redeploy.
5. Verify actual model traces and queue eligibility. Leave the queue underfilled when quality gates reject content.
6. Consider `all` only after at least seven days and ten mature pilot posts, with no approval/edit burden or mature-performance regression. Insufficient evidence retains the pilot.

## Production observations and limits

Read-only inspection of connected agent 13 (`@geoffwoo`) found one eligible queued draft on the existing GPT control stack and existing audience voice complaints, low generation yield, and insufficient queue depth. The existing learning summary covered 722 posts; the active corpus had 32 of its target 40 anchors. Retrieved voice references carried `timeline_unmatched` provenance. The two explicitly pinned posts were media/quote dependent and excluded from standalone diction anchors. This is a concrete quality bottleneck; a stronger model is not proof of better copy or future virality.

At credential inspection, the project's downloaded Production `OPENAI_API_KEY` was empty. The operator has been asked to configure it in Vercel without sharing the key in chat. Consequently, no real Astra model call, completed comparison, pilot activation, or seven-day performance result is claimed by this audit. Synthetic regressions verify request compatibility, not provider access or writing quality.

Distributed concurrency regressions use independent module runtimes and a shared Redis-script test double; they do not certify every production Redis failure mode. CAS covers the affected ledgers, not every remaining read/modify/write object. Legacy Stripe reservation receipts are preserved because their historical completion state cannot safely be inferred; existing invoice reconciliation remains necessary for older missed events. Existing bounded X lookup budgets can delay removal confirmation. No automatic SOUL migration or new analytics dashboard is introduced.

Independent review covered distributed storage, replay, Stripe, manual publishing, model compatibility, and exploration; discovered races and stale-state gaps were fixed and regression tested. Full-suite and deployment receipts are recorded below after verification.

Pre-commit verification: 144 test files / 1,349 tests passed; TypeScript passed. Production builds passed during integration; CI will repeat the complete test/type/build sequence on the submitted commit.

The initial read-only snapshot captured and validated all 40 distinct packets with hash `f9543af86ac5a09215d5c236cf448dd916a6a5fad01c9616fa5d0b300628da79`, three separate unverified-authorship account references, and 16 calibration anchors. A real run correctly stopped before provider calls because the OpenAI key was absent. Re-capture after the production learning rebuild before collecting comparison votes.
