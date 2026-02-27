# How to Install OpenClaw on Ubuntu VPS

## Best for
24/7 agent operations and long-running automations.

## 1) Harden the host first
```bash
sudo apt update && sudo apt upgrade -y
sudo adduser claw
sudo usermod -aG sudo claw
```
Use SSH keys, disable password auth, enable firewall before public exposure.

## 2) Install runtime dependencies
```bash
sudo apt install -y git curl build-essential python3 python3-pip
# install Node LTS (example)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

## 3) Install OpenClaw and verify
```bash
openclaw --help
openclaw status
```

## 4) Configure environment
Store model keys and required runtime config in secure env files.

## 5) Verify gateway/service lifecycle
```bash
openclaw gateway status
openclaw gateway restart
openclaw gateway status
```

## 6) Sanity test
Run one low-risk task and confirm logs/output.

## Failure modes
- service won’t start: bad env variables or missing dependency
- cron drift: incorrect timezone/clock sync
- tool failures: OS permissions/network egress limits

## Recovery ladder
1. check service status
2. check environment vars
3. run minimal test task
4. restart gateway
5. roll back recent config changes

## Next steps
- [OpenClaw Troubleshooting Handbook](/guides/openclaw-troubleshooting-handbook)
- [OpenClaw for Support Automation](/playbooks/openclaw-for-support-automation)
