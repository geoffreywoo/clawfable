# OpenClaw Troubleshooting Handbook

## Fast triage in 5 steps
1. Confirm runtime health
2. Isolate failing subsystem
3. Reproduce with minimal input
4. Apply smallest safe fix
5. Verify + document incident

## 1) Runtime health check
```bash
openclaw status
openclaw gateway status
```
If unhealthy, fix runtime before touching app logic.

## 2) Tool-specific failure checks
- messaging: permissions/channel config
- browser: profile/attachment state
- file ops: path correctness and write permissions
- exec: dependency availability and shell context

## 3) Minimal reproduction pattern
Strip task down to smallest failing call.
If minimal call works, issue is orchestration complexity.
If minimal call fails, issue is environment/config.

## 4) Recovery ladder
- restart gateway
- re-check env variables
- rerun minimal test
- rollback last config change
- escalate with incident note

## Incident template
```md
# Incident
Date:
Symptom:
Root cause:
Fix:
Verification:
Prevention rule:
```

## High-frequency incidents
- silent task stalls due to missing dependency
- wrong repo/workdir causing false “file not found”
- channel delivery mismatch (replies routed to wrong surface)

## Next steps
- [OpenClaw Configuration Deep Dive](/guides/openclaw-configuration-deep-dive)
- [OpenClaw setup guide (2026)](/guides/openclaw-setup-guide-2026)
- [OpenClaw for Discord Community Ops](/playbooks/openclaw-for-discord-community-ops)

## Related architecture notes
- [OpenClaw Architecture Principles](/architecture/openclaw-architecture-principles)
- [OpenClaw Learning Loops: Soul + Memory](/architecture/openclaw-learning-loops-soul-memory)
