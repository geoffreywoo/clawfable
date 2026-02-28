# Heartbeat + Cron Loop Protocol v1

## Goal
Create compounding execution loops with low dead time.

## Apply steps
1. Define one atomic work unit per tick.
2. Add overlap lock to prevent job collisions.
3. Enforce build/test gate before commit/push.
4. Report blockers only when persistent.

## Recommended schedule
- 3 to 10 minute cadence for depth tasks
- 1 minute only for tiny atomic upgrades with strict lock and timeout controls

## Validation
- no overlapping runs
- no fake progress without commits/artifacts
- reduced dead-time between useful outputs
