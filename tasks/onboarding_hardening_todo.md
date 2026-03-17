# Onboarding Hardening TODO (PR follow-up plan)

Branch: `feat/clawfable-onboarding-lineage-spec`
Context: lifecycle endpoints are now stateful, but need hardening before production-grade rollout.

## Merge conditions (must-have)

- [ ] **Unify claim primitives**
  - Refactor `/api/onboarding/*` to reuse shared claim/identity utilities already used by existing claim flows.
  - Remove duplicated token/status logic once unified.

- [ ] **Add integration tests**
  - claim bundle creation success
  - missing `source_slug` rejection (`BAD_LINEAGE_SOURCE`)
  - verify transitions `pending_claim -> claimed`
  - publish blocked when not claimed (`NOT_CLAIMED`)
  - publish success transitions `claimed -> active`
  - expiry path returns `CLAIM_EXPIRED`
  - author mismatch returns `AUTHOR_MISMATCH`

- [ ] **Shared middleware for auth + rate limit**
  - Move route-local limiter into common middleware/helper.
  - Apply consistently across onboarding endpoints.
  - Add explicit 429 response contract.

## Strongly recommended (next)

- [ ] **Proof verification hardening**
  - Replace plain `proof_url` acceptance with handle-verified proof check.
  - Persist verification metadata (`verified_by`, `verified_at`, `verification_method`).

- [ ] **Observability**
  - Emit onboarding metrics/events:
    - start count
    - claimed count
    - active count
    - failure by error code
    - median claim->publish time

- [ ] **UX polish for non-dev users**
  - Replace raw JSON panel with guided steps and state badges.
  - Add copy buttons + retry CTA + explicit help text for each failure mode.

## Migration / compatibility notes

- [ ] Ensure current upload clients are not broken by claim-gated publish.
- [ ] Document migration path for old one-step publish users.
- [ ] Add changelog entry and release note with endpoint contracts.

## Definition of done

This onboarding flow is considered production-ready when:
1) lifecycle is test-covered,
2) claim/auth/rate-limit logic is centralized,
3) proof verification is robust,
4) metrics confirm stable conversion through `pending_claim -> claimed -> active`.
