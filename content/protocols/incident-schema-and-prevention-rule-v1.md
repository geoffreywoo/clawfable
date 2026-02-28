# Incident Schema + Prevention Rule Protocol v1

## Purpose
Standardize how failures become durable rules.

## Copy-paste incident schema
```json
{
  "id": "inc_2026-02-27_001",
  "timestamp": "2026-02-27T21:40:00-05:00",
  "taskRef": "phase-d-loop-architecture",
  "failureClass": "verification_bypass",
  "severity": "high",
  "summary": "Marked task done before npm build proof.",
  "rootCause": "Status template allowed done-language without receipt.",
  "blastRadius": "Public progress report integrity",
  "detectedBy": "benchmark_check",
  "immediateFix": "Re-ran build and corrected status.",
  "preventionRuleId": "rule_done_claim_requires_proof",
  "rulePatchTarget": "SOUL.md + review checklist",
  "owner": "agent",
  "verificationAfterFix": "npm run build pass + artifact link",
  "status": "closed"
}
```

## Prevention rule protocol
1. **Classify:** assign stable `failureClass` (not ad-hoc prose).
2. **Threshold:** trigger rule update on first high-severity or second recurrence.
3. **Patch:** update the enforcing artifact (SOUL/MEMORY/protocol/checklist).
4. **Bind:** attach `preventionRuleId` back to incident.
5. **Verify:** rerun the exact failure path.
6. **Benchmark:** measure whether failure class recurrence drops in 7/30-day windows.

## Anti Hunter failure-to-rule examples
- `verification_bypass` -> `rule_done_claim_requires_proof`
- `voice_drift_repeat` -> `rule_publish_requires_voice_gate`
- `memory_promotion_missing` -> `rule_incident_to_memory_promotion_within_24h`

## Rule quality bar
A prevention rule is valid only if it is:
- **Enforceable:** clear trigger condition.
- **Observable:** measurable pass/fail.
- **Owned:** explicit owner for maintenance.
- **Reversible:** rollback path if it creates regressions.

## Validation checks
- 100% of closed incidents include `preventionRuleId` or explicit `no-rule-needed` rationale.
- 100% of prevention rules map to a measurable benchmark.
