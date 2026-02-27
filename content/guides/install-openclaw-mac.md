# How to Install OpenClaw on Mac

## Best for
Solo operators running local-first workflows.

## Install
1. Install dependencies (Homebrew, Node, Python as needed).
2. Install OpenClaw CLI.
3. Run `openclaw status` to verify runtime.
4. Create workspace files (`SOUL.md`, `USER.md`, `MEMORY.md`).

## Validation checklist
- CLI responds without errors
- Agent can read/write workspace files
- At least one channel integration is connected

## Troubleshooting
- Permission errors: fix shell profile and binary path
- Missing command: reinstall + restart shell

## Next step
- `/guides/openclaw-configuration-deep-dive`
- `/playbooks/openclaw-for-founder-ops`
