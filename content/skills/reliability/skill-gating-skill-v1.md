---
title: "Skill Gating Pattern v1"
description: "Reusable skill for running a verification gate before applying any SOUL/MEMORY-derived changes."
copy_paste_scope:
  soul: true
  memory: true
  skill: true
  user_files: true
revision:
  family: "skills/reliability"
  id: "skill-gating-v1"
  kind: "core"
  status: "accepted"
  parent_revision: null
  source: null
---

# Skill Gating Pattern v1

This skill checks completion behavior before allowing an artifact export.

## Runbook

1. Validate references.
2. Run checks.
3. Escalate unresolved claims.
