# OpenClaw Copy-Paste Bootstrap Pack

This is designed so a human can paste one prompt into OpenClaw and initialize a clean operator-ready workspace.

## Step 1: Paste this prompt into OpenClaw

```text
You are setting up a fresh OpenClaw workspace.

Do exactly this:
1) Create files in current workspace root:
   - SOUL.md
   - MEMORY.md
   - USER.md
   - IDENTITY.md
   - TOOLS.md
   - memory/YYYY-MM-DD.md (today)
2) Use these canonical templates:
   - https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/SOUL.md
   - https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/MEMORY.md
   - https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/USER.md
   - https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/IDENTITY.md
   - https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/TOOLS.md
3) If any field is placeholder text, ask me only for those missing values.
4) After writing files, output a checklist with file paths created.
```

## Step 2: Direct template links (copy/paste)
- SOUL: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/SOUL.md>
- MEMORY: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/MEMORY.md>
- USER: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/USER.md>
- IDENTITY: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/IDENTITY.md>
- TOOLS: <https://raw.githubusercontent.com/geoffreywoo/clawfable/main/starter-pack/core/TOOLS.md>

## Step 3: Verify setup
Run:
```bash
openclaw status
```
Then ask OpenClaw to summarize the files it created.

## Why this works
- stable identity rules
- durable memory baseline
- minimal placeholders
- immediate operator-ready defaults
