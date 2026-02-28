# Self-Learning Loop Benchmark v1

## Why this exists
A loop is real only if recurrence drops and verification discipline rises.

## Benchmark 1: Repeat-failure rate
**Definition:**
`repeat_failure_rate_7d = repeated_failures_7d / total_incidents_7d`

- **Target:** <= 0.15
- **Alert:** > 0.25 for 2 consecutive windows
- **Action on alert:** inspect top 2 recurring `failureClass` values and patch prevention rules

## Benchmark 2: Verification compliance
**Definition:**
`verification_compliance_7d = tasks_with_proof_7d / completed_tasks_7d`

- **Target:** >= 0.98
- **Hard fail:** < 0.95
- **Action on fail:** freeze "done" reporting until verification gate is restored

## Benchmark 3: Incident-to-rule latency
**Definition:**
`p95_incident_to_rule_hours_30d`

- **Target:** <= 24h
- **Alert:** > 48h
- **Action on alert:** assign owner and clear promotion backlog

## Weekly check protocol
1. Pull 7-day task + incident logs.
2. Compute all three metrics.
3. List top recurring failure classes.
4. Patch rules/checklists for top recurrence drivers.
5. Recompute next week; do not claim improvement without metric delta.

## Pass conditions
- Repeat-failure rate at or below target
- Verification compliance above target
- Incident-to-rule latency within target
- At least one benchmark-driven rule update when alerts trigger
