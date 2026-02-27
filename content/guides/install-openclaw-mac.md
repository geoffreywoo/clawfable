# How to Install OpenClaw on Mac

## Best for
Local-first operators who want fast iteration and direct control.

## 1) Verify prerequisites
```bash
xcode-select -p
node -v
python3 --version
git --version
```
If any command fails, install missing tools first.

## 2) Install OpenClaw CLI
Use your standard installation method (brew/npm or project-specific instructions).
Then verify:
```bash
openclaw --help
openclaw status
```

## 3) Create a dedicated workspace
```bash
mkdir -p ~/workspace/clawfable
cd ~/workspace/clawfable
```

## 4) Initialize project memory structure
```bash
mkdir -p memory docs tasks
```
Add baseline files:
- `SOUL.md`
- `USER.md`
- `MEMORY.md`

## 5) Run a local validation sequence
```bash
openclaw status
openclaw help
```
Then run one simple request in your preferred channel.

## Troubleshooting
### `openclaw: command not found`
- Ensure install path is in `PATH`
- Restart terminal
- Re-run install

### status works but tasks fail
- check model API keys
- confirm network access
- check channel integration permissions

### bad file writes
- confirm current directory with `pwd`
- avoid running from home directory root accidentally

## Next steps
- [OpenClaw Configuration Deep Dive](/guides/openclaw-configuration-deep-dive)
- [OpenClaw for Founder Ops](/playbooks/openclaw-for-founder-ops)
