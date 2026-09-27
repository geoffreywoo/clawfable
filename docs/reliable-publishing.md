# Reliable original publishing rollout

Agent 13 is the first account in this rollout. `ProtocolSettings.durableGenerationEnabled` controls it; other accounts keep the existing path. Original posting targets five/day and five publishable queued drafts. Replies retain their emergency block.

## Execution

`/api/cron/generate` runs every ten minutes offset from posting. One fenced account job owns immutable subject context, paid response checkpoints, raw ideas, draft evaluations, reserve selection, and final selected output. A 240-second worker yields before starting a stage without its complete timeout allowance. The next tick replays saved responses and resumes unpaid work. Selected output remains leased until queue acknowledgement; deterministic candidate-to-tweet identity recovers partial persistence.

Posting no longer performs generation or expensive discovery for the rollout account. Background topic/research/learning moves to the hourly research worker. Current final quality gates are retained. The new idea contract uses publicMove, contentMode and evidence IDs; stylistic idea warnings remain auditable diagnostics, while factual/policy/duplicate failures remain blockers.

Completed jobs remain addressable by job ID after the active pointer advances. Provider outages preserve paid stages across repeated failures. Successful queue insertion makes remaining qualified ideas eligible before new ideation, under the same lifetime job budget. Content receipts expire with their subject packet; publishing rechecks current source hashes and withdrawal state. Interest observations keep their original timestamps, including during failed cache refreshes. Subjective ideas from researched subjects can use the strict no-evidence opinion contract instead of manufacturing citations.

Original X writes have a durable account dispatch record. Ambiguous responses and failures to persist an accepted response hold further writes until official timeline/text/author reconciliation. An empty timeline is not proof of failure and never permits an automatic duplicate. The posting path uses five Pacific-day slots with small stable jitter and a two-hour minimum for catch-up; the existing rolling-24-hour cap still applies. Read-only status reports publishable depth through the same posting checks, current stage, rejection counts, retry action, canary spending, original-only counts and conversion rates.

Generation receives a protected $15 of the existing $20 Pacific-day budget, research/topic work is capped at $2, other background operations at $3. Generation may borrow unused capacity. Each durable job keeps the $3 lifetime ceiling across resumes. A generation-canary operational record caps initial experiments at $6 and stops after three consecutive completed empty editorial attempts (including attempts with reserve ideas); two distinct queued outputs pass the canary. Neither top-ups nor deleting unknown charges are automatic.

Provider IDs and successful results are stored with spend receipts. The worker retrieves uncertain OpenAI responses where supported. Unknown usage remains committed; unavailable reconciliation is explicit. Successful response replay requires the same job and request fingerprint.

## Calibration and outstanding acceptance

The collector supports the active judge model/policy. At rollout inspection, owner labels were zero approvals and nine explicit rejections, with no matching current scores. The final editorial threshold is therefore unchanged. A private 20-draft owner review was prepared; responses must be persisted as actual owner decisions before calibration. Do not infer approvals from generation scores or historical autoposts.

The measured acceptance target is five confirmed original posts on each of three complete Pacific days, <=$20/day in commitments, a five-post reserve that replenishes, and no duplicate or unsupported posts. Passing local tests or the two-output canary does not establish this target.

Follow-up verification must inspect job stage/blocker/retry time, paid and unresolved spend, queue truth, final critic provenance, and official X post receipts. Monitor actionable changes only. Stop paid canary work at its cap, fix the failed stage, and preserve all receipts. Account-scoped final editorial recalibration remains gated on sufficient owner-labelled held-out evidence.

## Live evidence — September 26, 2026 Pacific

- Posting enabled at five/day, reserve target five; replies retain their emergency block. The initial live canary is `reliable-originals-2026-09-26`, capped at $6.
- First completed job: three ideas repeated an unverified numbered Starship flight. All correctly failed factual gating. Spend $0.19299. The prompt now explicitly separates subject cues from verified events.
- Second job: three ideas, two initially eligible, one selected, three written variants. All variants failed the existing deterministic technical-credibility floor before paid copy judgment. Spend $0.29674; reserve ideas and completed stages retained. A valid subjective alternative was also incorrectly rejected for missing citations; the opinion-mode compatibility fix revalidates saved ideas without regenerating them.
- Third job: three eligible ideas and three written variants; all variants again failed the deterministic technical-credibility floor before model judgment. Spend $0.28737. The canary is blocked after three completed editorial-empty attempts; reserve availability does not exempt an empty attempt. Counting is deduplicated by attempt identity, and operational deferrals remain separate.
- Combined live canary commitments: $0.77710 of $6; zero queue-qualified originals and zero verified publications. Pacific-day commitments at inspection were $11.88815, including $5.49037 unresolved. No funds were added and unknown charges remain committed.
- The repeated technical gate uses a narrow mechanism/artifact vocabulary that omits carbon capture, CO2 purification, and brewing. This identifies a credible coverage defect, but does not establish that any rejected draft meets the complete publishing contract. A bounded, checkpointed expression repair is implemented for sound premises; it has not been proven by a live canary. No heuristic keywords or final thresholds were relaxed to force acceptance.
- Paid canary work stays stopped. Resume only after a documented offline fix/evaluation addresses the measured failed stage, preserving the same campaign spend. Do not simply reset the empty counter. Any final decision change still requires the planned owner-labelled calibration.
- Legacy selection-only and operational-only candidate rejections are reinterpreted on read for the rollout account; raw stored history is preserved. Qualified exploration uses every fifth durable selection. Learning provenance exclusions remain in force.
- The current final decision remains unchanged. Owner calibration has zero eligible approvals and nine rejections before the pending private review. Edited siblings now share a transitive premise/lineage partition, and prompt-anchor exclusion covers their entire lineage.
- A two-hour heartbeat monitors and continues the authorized rollout, beginning sustained-delivery measurement no earlier than September 27. Three full qualifying Pacific days and a replenished five-post reserve remain outstanding.

## Verification of the stop and recovery follow-up

All 168 test files passed (1,849 tests), including the corrected distributed-storage harness. TypeScript checking and the production build passed. Targeted coverage includes canary deduplication, legacy operational/selection dispositions, single expression-repair eligibility, and qualified fifth-selection exploration. These checks establish implementation behavior, not live editorial yield.

## September 26 follow-up — 11:40 Pacific

The canary remained blocked at $0.77710, with no new original generation, queue entries, or X publication receipts. Daily commitments were $12.33824, including the unchanged $5.49037 unresolved; the $0.45009 increase came from seven settled background research, topic, seed, and performance calls. Both production domains responded successfully and the exact production deployment remained Ready.

Offline replay of all six saved canary drafts reproduced the technical failure: four scored 0.160, one 0.215, and one 0.220 against the unchanged 0.450 floor. All six received zero domain and specificity credit. This supports the vocabulary-coverage diagnosis; it is not an owner-quality label or proof of factual correctness. The private replay artifact is `.gstack/reliable-publishing/2026-09-26-technical-replay.json`. No paid experiment or policy relaxation was used.

Posting logs were still emitting a generic empty-queue message despite the explicit canary stop. The follow-up fixes those missed-slot reasons to name the durable stage/blocker, failed gates, and next eligible action. A blocked canary overrides an old reserve retry timestamp and explicitly reports that automatic retry is stopped; expired evidence cannot be described as resumable. Owner calibration and a validated content-stage recovery remain outstanding.

Validation: 1,852 tests across 169 files passed after isolating the judge-recovery fixture from random subject rotation; the fixture now explicitly pairs its fixed investing prediction with a markets brief. The three new blocker tests cover canary precedence, evidence expiry, and provider retry timing. The posting log looks up the active job's trace, so an unrelated newer preview cannot supply its rejection reasons.

## September 27 — evidence-gated recovery

Concurrent upstream commit `3905673` added technical-mechanism prompt guidance and automatic canary restart on a code-policy change. At 09:43 Pacific it restarted the original campaign, cleared its attempt IDs, and spent another $0.28540. That batch produced three drafts rejected only for `missing_verified_entity_tag`; total campaign commitments reached $1.06250 with zero queued originals. The previous three empty-attempt IDs were recovered from monitoring evidence and merged with the fourth attempt, and the campaign was held again. The technical prompt changes are preserved.

Recovery now requires an explicit reviewed offline-evaluation reference and SHA-256 receipt for the current policy. Worker ticks cannot restart a blocked canary on a version bump. Recovery snapshots the previous count/policy/attempt IDs, retains all attempt identities for deduplication, retains the same campaign and dollar cap, and cannot reuse an evaluation receipt after another stop. This is an implementation condition on the already authorized bounded recovery, not a new owner-approval requirement.

The measured fourth-batch failure revealed two repair-path defects. Missing a supplied verified handle was not eligible for the single expression repair. Also, preflight repairs were incorrectly required to carry a critic's preserve-span decision before the critic had run. Durable preflight repairs now admit the missing-tag case with a sound premise, pass through the same factual/payload gates and final judge, and skip only that inapplicable pre-critic span requirement. Existing critic span contracts remain enforced. No final editorial threshold or factual gate changed.

The integration evaluation injects a missing-tag draft, verifies exactly one repair with the registry-provided handle, forces the final judge to fail, and resumes the same job. It requires the paid repair to be reused rather than generated again. This establishes recovery mechanics, not owner approval or publishable quality; final judgment and the live two-original canary remain required.

Recovery validation passed: 1,855 tests across 169 files, TypeScript checking, and the production build. The bounded restart must retain the original campaign and $6 limit, and first try the already paid draft from the missing-tag batch.

The evaluated recovery resumed at 09:56 Pacific with receipt `94fc3e0e078ebac753f84b45a5a7c103977ee4bf365fa1a5e317e44469dcdb43`, after deployment `f82ae8d` was Ready on both production aliases. The saved job reused ideation and original writing, bought one repair plus final judgment, and reached the critic for the first time. The critic rejected the repaired draft on editorial quality; campaign commitments became $1.24500, still with zero queued originals. This is one completed empty attempt in the new recovery window. Recovery attempt IDs now include their recovery receipt ID so a newly repaired/reassessed idea counts once in that window while retaining and deduplicating all old history.

The recovery stopped automatically at 10:02 Pacific after three completed editorial-empty attempts. All three saved ideas reached final judgment after the repair-path fixes; none qualified. Total campaign commitments are $1.68773/$6 and September 27 daily commitments are $2.50062/$20. The prior day's $5.49037 unresolved charges remain in their original ledger receipts. Queue depth and confirmed original publications remain zero. The measured bottleneck is now idea/copy quality at final judgment, not provider execution or lost paid work. No additional paid recovery is authorized by this evaluation receipt, and another code-version bump must not restart the campaign. The next change must address that measured editorial stage with new offline evidence while retaining factual gates and the calibration requirement for final-policy changes.
