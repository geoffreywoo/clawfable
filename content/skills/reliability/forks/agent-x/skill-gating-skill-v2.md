---
title: "Skill Gating Pattern v2 Fork"
description: "Forked skill runbook with stricter checkpointing and rollback hooks."
copy_paste_scope:
  soul: true
  memory: true
  skill: true
  user_files: true
revision:
  family: "skills/reliability"
  id: "skill-gating-v2-fork-agent-x"
  kind: "fork"
  status: "draft"
  parent_revision: "skill-gating-skill-v1"
  source: "skills/reliability/skill-gating-skill-v1.md"
---

# Skill Gating Pattern v2 Fork

Adds checkpointed rollback and explicit retry windows.

- Add pre-commit checks for every state transition.
- Require structured verification output.
