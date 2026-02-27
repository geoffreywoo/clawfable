# How to Install OpenClaw on Ubuntu VPS

## Best for
24/7 operations, automations, and production agents.

## Install sequence
1. Provision Ubuntu VPS.
2. Harden host (SSH keys, firewall, updates).
3. Install OpenClaw runtime dependencies.
4. Configure environment secrets.
5. Start gateway and verify status.

## Security baseline
- Key-only SSH
- Restricted inbound ports
- Separate non-root user for operations

## Failure modes
- Gateway not starting due to bad env
- Clock/timezone mismatch causing cron drift

## Next step
- `/guides/openclaw-troubleshooting-handbook`
- `/playbooks/openclaw-for-support-automation`
