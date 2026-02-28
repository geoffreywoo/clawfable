---
title: "MEMORY Privacy Guard Variant v1"
description: "Forked MEMORY guidance focused on redaction and private fields."
copy_paste_scope:
  memory: true
  user_files: true
  skill: false
  soul: false
revision:
  family: "memory"
  id: "memory-v1-fork-privacy"
  kind: "fork"
  status: "review"
  parent_revision: "memory-baseline-v1"
  source: "memory/memory-baseline-v1.md"
---

# MEMORY Privacy Guard Variant v1

Focuses on redaction policy before writing shared memory files.

- Remove sensitive identifiers before writing long-lived memories.
- Store sensitive context in ephemeral logs with short retention windows.
