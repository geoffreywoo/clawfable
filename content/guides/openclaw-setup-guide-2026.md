# OpenClaw Setup Guide (2026)

## Who this is for
Founders and operators who want a production-capable OpenClaw setup in under 60 minutes.

## What you’ll have by the end
- A working OpenClaw workspace
- Correct identity + memory files
- Verified runtime status
- A safe first execution loop

## Prerequisites
- Mac or Linux machine
- GitHub account
- API keys for the model providers you plan to use
- A terminal with admin access

## Step 1: Create your workspace
```bash
mkdir -p ~/clawfable-ops
cd ~/clawfable-ops
```

## Step 2: Initialize core identity files
Create these files first:
- `SOUL.md` (voice + principles)
- `USER.md` (who the agent serves)
- `MEMORY.md` (long-term curated memory)
- `memory/YYYY-MM-DD.md` (daily working memory)

Minimal starter:
```bash
mkdir -p memory
cat > SOUL.md <<'EOF'
# SOUL
Direct, concise, execution-focused. No fluff.
EOF

cat > USER.md <<'EOF'
# USER
Name: operator
Primary goal: ship reliable automation
EOF

cat > MEMORY.md <<'EOF'
# MEMORY
Long-term decisions and durable preferences.
EOF

date +%F | xargs -I{} sh -c 'cat > memory/{}.md <<EOF
# {}
Session notes.
EOF'
```

## Step 3: Configure environment variables
Store keys in your shell profile or runtime env file.

Example pattern (replace values):
```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
```

## Step 4: Validate runtime
```bash
openclaw status
```

You should see healthy runtime metadata (agent, host, model, channel).

## Step 5: Run a safe first task
Use a low-risk task first:
- summarize project files
- draft a plan
- create a checklist

Avoid high-risk external actions until safety boundaries are explicit.

## Common failure modes
1. **Missing API keys** → status appears healthy, but model calls fail.
2. **Wrong working directory** → file reads/writes fail silently in the wrong repo.
3. **Over-permissioned tools** → accidental external actions too early.

## Production baseline checklist
- [ ] identity files exist
- [ ] memory folder exists and is writable
- [ ] `openclaw status` healthy
- [ ] first task executed successfully
- [ ] safety boundaries documented

## Next steps
- [Install OpenClaw on Mac](/guides/install-openclaw-mac)
- [Install OpenClaw on Ubuntu VPS](/guides/install-openclaw-ubuntu-vps)
- [OpenClaw Troubleshooting Handbook](/guides/openclaw-troubleshooting-handbook)
