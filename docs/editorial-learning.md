# Durable editorial learning

Clawfable keeps the original three-stage worker: choose a thought, write three variants, make one editorial decision. For @geoffwoo, the threshold remains 0.75, replies remain emergency-disabled, and the existing evidence, ownership, duplicate-write, posting and spending protections remain in force.

## Optional owner direction

The authenticated `/api/agents/[id]/editorial-steering` endpoint stores direction separately from outcome feedback and account restrictions. POST accepts `requestId`, `kind` (`topic`, `take`, `copy`), `instruction`, `scope` (`one_off`, `standing`), and optional `topic`, `ideaId`, `draftId`, `expiresAt`. Use a stable requestId when retrying an owner message. Conflicting reuse returns 409. Linked candidates must belong to the account. GET returns durable records and lifecycle status; DELETE accepts `id` and a new `requestId` and revokes direction for future jobs.

A one-off binds atomically to the next unfrozen durable job, including its reserve ideas; it does not mean one guaranteed published post. Unclaimed one-offs expire after seven days unless an explicit expiry is supplied. Standing direction remains until revoked or its supplied expiry. Both are preferences, never new deterministic vetoes. Explicit bans belong in the existing account restriction workflow.

Every new job freezes at most four directions. A topic field on topic guidance proposes a subject through the existing opinion path alongside the ordinary source pool; it does not establish any external fact. An unavailable or restricted suggestion leaves eligible ordinary subjects available. Take and copy guidance reaches all three stages. An unanswered slate creates no steering record and no publication approval or hold: the already-authorized worker simply continues.

The store preserves original instructions, authenticated owner identity, request IDs, claim IDs and lifecycle events. It never trains on silence or presents assistant-written copy as a human edit. Records and job claims are bounded; 256 records is an explicit maintenance boundary for new steering intake, not a generation stop. Do not delete audit history to make room; archive/migrate the store when needed.

## Accepted revisions and receipts

The compact context includes up to two complete accepted owner edits with their signal IDs. Inferred, superseded, rejected and evaluation-only examples are excluded. Whole examples that exceed the compact budget are omitted rather than cut into misleading fragments. Examples teach expression and judgment, never facts or reusable premises. They do not bypass editorial assessment.

`subjects_ready` stores the exact per-subject context; `editorial_steering` freezes the claimed directions; `editorialSteeringUse` records included context IDs, the requested-topic ID, and any IDs omitted by the budget. `editorialSteeringUnavailable` and `editorialSteeringCompletionPending` make optional storage gaps visible. A consumed record means an editorial attempt completed, not that a post was published or every instruction fit. Check `editorialSteeringUse` for application and official X receipts for publication.

Paid stages and their context survive interruptions and routine learning refreshes. Later direction and revocation affect future unfrozen jobs. A release does not add fresh coaching to already purchased copy. New context and request hashes bind new decisions to exact feedback, evidence and text; historical receipts and spending are retained.

## Fresh takes and measured returns

The continuous @geoffwoo original path retrieves relevant prior originals and queue commitments instead of showing only the first twelve old premises. These comparisons are not voice examples or factual evidence. The existing single Astra editorial call classifies each variant as fresh, a returning take, or uncertain and names its matching prior posts. A same-core paraphrase without a valid return exception uses the existing `substantive_duplicate` blocker; sharing a topic alone is not a duplicate. The score cutoff remains 0.75 and no additional critic call is purchased.

Return eligibility requires mature official X performance history, with at least eighteen measured hours and five distinct mature baseline posts. A sticky `wasViral` flag or projected early spread is insufficient. Measured likes must meet the account's viral threshold and three times its mature median, or measured relative spread must clear 0.78. The proof retains the original IDs, measurement time, actual counts, baseline and criterion. Historical performance proof can remain useful; new factual claims still need current evidence.

Conservative implementation defaults are fourteen days and twenty intervening originals since the latest matching publication, with at most one returning take per ten originals and a queued-return reservation. These are product defaults, not numbers specified by the owner. A proven original can anchor another return even if its intervening return was not itself viral, but every matching publication must clear spacing and deleted posts cannot authorize a return. Verbatim reposts remain blocked.

The comparison payload freezes once before the first dispatch of each final assessment, so retries use the same paid request. New proof is bound to the exact assessed text and checked again against live history at admission, queue readiness and posting. A rejected selection advances to saved reserves through the scheduled worker. Old completed or dispatched judgments retain their original paid contract; known stale queue artifacts can be quarantined without rewriting copy or inventing owner feedback. Autopilot, budgets and the normal publishing boundary remain active.

## Topic relevance and recovery

Explicit account interests, owner-authored topic history and direct engagement establish topic relevance. Shared words in a long source post or a generated style appendix do not. Followed-network discovery retains its source author, URL, topic ID and observation time, and is never counted as operator-authored history. Low-fit exploration ranks after stronger owner interests and has a bounded discovery slot.

Historical cue words explain selection and remain diagnostics on the simple original path; they cannot independently reject a valid opinion. Unsupported claims and the other substantive blockers still reject. Rejected batches retain scheduled recovery and budget limits.

## Codex workflow

Offer a compact optional morning/afternoon topic slate. Record explicit feedback as topic, take or copy, linking the actual draft/idea when available; default tentative selections to one-off, and use standing only for explicit continuing direction. Persist through the authenticated API, read back the record, and verify its ID appears in a later frozen job. An assistant suggestion that receives no reply is not owner evidence. The production worker remains the sole X writer. Check publication through official X APIs.

Keep the operational runbook and append-only observations in `.gstack/continuous-posting/`. Measure delivery, reserve replenishment and spending separately from deployment success. Feedback bookkeeping failures must not discard a qualified paid candidate.
