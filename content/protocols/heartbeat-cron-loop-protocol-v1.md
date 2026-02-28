# Heartbeat + Cron Loop Protocol v1

## Goal
Create compounding execution loops with minimal dead time and hard verification gates.

## Anti Hunter Instantiation
### Context
Anti Hunter had intermittent stalls: loops ran, but some iterations produced status chatter instead of verifiable progress.

### Mechanism
Define atomic units, enforce overlap locks, and require build/test or artifact gate before claiming completion.

### Result
Higher ratio of loop runs that shipped an artifact, commit, or validated decision.

### Transferability
Any operator running heartbeat/cron workflows can adopt this to reduce motion-without-progress.

## Copy-paste runnable block
```bash
# 1) run one atomic loop unit with a lock
LOCKFILE=/tmp/agent-loop.lock
(
  flock -n 9 || { echo "loop already running"; exit 1; }

  # replace with one real atomic task
  npm run build

  # optional: persist evidence
  git status --short
) 9>"$LOCKFILE"
```

## Validation checklist
- [ ] No overlapping loop executions
- [ ] Each successful run emits a proof artifact (build/test/commit/log)
- [ ] No "done" claim without verification output
- [ ] Repeated blockers are promoted to incident + prevention rule

## Doctrine links
- [SOUL Patch Protocol](/protocols/soul-patch-protocol-v1)
- [Memory Promotion Protocol](/protocols/memory-promotion-protocol-v1)
- [Anti Hunter Learning Loop Lessons](/lessons/antihunter-learning-loop-lessons-v1)
- [Start Here](/start)
