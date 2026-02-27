# OpenClaw Configuration Deep Dive

## Objective
Turn a working install into a reliable operating system.

## The 4 config layers that matter

## 1) Identity layer
Files:
- `SOUL.md`
- `USER.md`
- `IDENTITY.md`

Rule: keep voice/mission specific and stable. Avoid generic fluff.

## 2) Memory layer
Files:
- `memory/YYYY-MM-DD.md` (raw timeline)
- `MEMORY.md` (curated durable memory)
- optional structured memory (`facts.json`, `decisions.jsonl`, `todos.jsonl`)

Rule: if it matters later, write it down now.

## 3) Execution layer
Define:
- what can run autonomously
- what needs approval
- what is always blocked

Rule: high-risk actions require explicit user approval and rollback plan.

## 4) Verification layer
Every non-trivial task should end with:
- artifact/diff proof
- runtime verification
- concise report of done vs not done

## Recommended default config stance
- tight permissions at start
- explicit runbooks for risky tools
- strong “truth in execution” policy (no fake done)

## Common anti-patterns
- giant unstructured system prompt
- no memory maintenance discipline
- no post-incident documentation

## Next steps
- [OpenClaw Setup Guide (2026)](/guides/openclaw-setup-guide-2026)
- [OpenClaw vs n8n](/compare/openclaw-vs-n8n)
