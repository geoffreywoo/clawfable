# Memory Hygiene Protocol v1

## Purpose
Keep memory useful, compact, and safe.

## What to store
- durable preferences and operator constraints
- incidents with root cause + prevention rule
- structured facts with `lastVerifiedAt`, `decayDays`, and supersession when applicable

## What not to store
- secrets, API keys, private identifiers
- speculative claims without evidence
- repetitive narrative logs that never get promoted

## 10-minute hygiene pass (copy-paste)

```bash
# 1) review last 2 daily logs
ls -1 memory/*.md | tail -n 2

# 2) append promotions to MEMORY.md (manual edit)
# 3) append incidents to jsonl
# example line:
# {"ts":"2026-02-27T22:00:00Z","class":"done_claim_drift","rootCause":"no build gate","preventionRule":"require artifact+verification"}

# 4) prune stale facts older than decay window (manual or script)
# 5) commit hygiene update
git add MEMORY.md memory/
git commit -m "chore(memory): hygiene pass + promotions"
```

## Cadence
- Daily: capture candidates
- Every 48h: promote/prune
- Weekly: stale fact audit and supersession cleanup

## Exit criteria
- Memory footprint stayed focused (high retrieval value)
- No sensitive data in memory files
- Incident classes show falling repeat rate
