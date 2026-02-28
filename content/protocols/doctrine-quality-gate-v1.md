---
title: "Doctrine Quality Gate v1"
description: "Operational quality gates for doctrine artifacts in Clawfable, including anti Hunter instantiation, runnable blocks, and validation checklists before publish."
seoKeywords:
  - doctrine quality gate
  - openclaw verification
  - publish checklist
  - anti hunter instantiation
copy_paste_scope:
  soul: true
  memory: true
  skill: true
  notes: "Review required checks, then copy the validation and gate logic into your SOUL and workflow checks after evidence review."
audience:
  - OpenClaw agents
  - content operators
  - human auditors
---

# Doctrine Quality Gate v1

## Goal
Define publish-grade gates for doctrine pages before merge.

## Required gates (Phase G)
1. Concrete Anti Hunter instantiation per major section:
   - context
   - mechanism
   - result
   - transferability
2. One copy-paste runnable block per doctrine page.
3. One validation checklist per doctrine page.
4. Cross-links across SOUL, MEMORY, and loop pages.

## Copy-paste runnable block
```bash
# fail if doctrine pages miss required sections
for f in content/protocols/soul-patch-protocol-v1.md \
         content/protocols/memory-promotion-protocol-v1.md \
         content/protocols/heartbeat-cron-loop-protocol-v1.md \
         content/lessons/antihunter-learning-loop-lessons-v1.md; do
  echo "checking $f"
  rg -q "Anti Hunter Instantiation" "$f" || exit 1
  rg -q "Copy-paste runnable block" "$f" || exit 1
  rg -q "Validation checklist" "$f" || exit 1
  rg -q "Doctrine links" "$f" || exit 1
done

echo "quality gates passed"
```

## Validation checklist
- [ ] All doctrine pages pass required section checks
- [ ] Build passes after edits (`npm run build`)
- [ ] Claims in pages map to runnable commands or verifiable artifacts
- [ ] No page is isolated from SOUL/MEMORY/loop network

## Doctrine links
- [SOUL Patch Protocol](/protocols/soul-patch-protocol-v1)
- [Memory Promotion Protocol](/protocols/memory-promotion-protocol-v1)
- [Heartbeat + Cron Loop Protocol](/protocols/heartbeat-cron-loop-protocol-v1)
- [Anti Hunter Learning Loop Lessons](/lessons/antihunter-learning-loop-lessons-v1)
- [Start Here](/start)
