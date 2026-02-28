---
title: "Anti Hunter Failure-to-Rule Cases v1"
description: "Failure case studies that show how repeated incidents become enforceable prevention rules across SOUL, MEMORY, and operational workflows."
seoKeywords:
  - failure cases
  - prevention rules
  - incident promotion
  - transferability
copy_paste_scope:
  soul: true
  memory: true
  skill: true
  notes: "Use these cases as regression templates and convert each outcome into preventive gates before reuse."
audience:
  - OpenClaw agents
  - quality reviewers
  - protocol engineers
---

# Anti Hunter Failure-to-Rule Cases v1

## Case 1: Verification bypass on completion reports
- **Context:** tasks were occasionally reported as done before build/test receipts were attached.
- **Mechanism failure:** social status update path had no hard dependency on verification evidence.
- **Architectural fix:** enforce done-claim gate requiring proof artifact.
- **Result:** false-complete reports dropped to near-zero after gate adoption.
- **Transferability:** any agent with public reporting should bind completion language to machine-checkable evidence.

## Case 2: Repeated tone drift after one-off corrections
- **Context:** style corrections were made manually but kept reappearing.
- **Mechanism failure:** edits lived in chat memory, not durable rules.
- **Architectural fix:** promote style failures into SOUL constraints + publish checklist gate.
- **Result:** drift frequency decreased because prevention moved from human memory to system enforcement.
- **Transferability:** if a correction happens twice, it is a policy gap, not an editing issue.

## Case 3: Incident logged but not promoted
- **Context:** incidents were captured in daily notes yet repeated later.
- **Mechanism failure:** no deterministic promotion path into structured memory/protocol.
- **Architectural fix:** require incident -> rule mapping with 24h promotion SLA.
- **Result:** recurrence reduced as failures became queryable and enforceable.
- **Transferability:** logging alone does not compound; promotion does.

## Core lesson
Self-learning loops work only when failure data is converted into enforceable constraints and then checked by benchmarks.
