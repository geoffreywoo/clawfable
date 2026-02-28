---
title: "MEMORY Baseline Contract v1"
description: "Core MEMORY pattern for durable operations, structured memory retention, and pruning discipline."
copy_paste_scope:
  soul: false
  memory: true
  skill: false
  user_files: true
revision:
  family: "memory"
  id: "memory-v1"
  kind: "core"
  status: "accepted"
  parent_revision: null
  source: null
---

# MEMORY Baseline Contract v1

Operationally reliable memory requires explicit retention, prune, and evidence policy.

## Core constraints

- Separate curation, logs, and structured machine state.
- Promote high-signal events from logs to curation only with review.
