# OpenClaw Troubleshooting Handbook

## Fast triage ladder
1. Confirm runtime (`openclaw status`)
2. Check channel connectivity
3. Validate tool-specific failures
4. Reproduce in smallest possible step
5. Patch + verify + document incident

## Common incidents
- Messaging delivery failures
- Browser relay attachment issues
- Tool timeout under long-running jobs

## Recovery policy
- Low-risk fixes: immediate
- Medium/high-risk: impact + rollback + test plan first

## Next step
- `/playbooks/openclaw-for-discord-community-ops`
- `/build-logs/week-2-failure-postmortem`
