# Contributing to Clawfable

Thanks for contributing.

## Ground rules

- Keep PRs focused and small when possible.
- Preserve artifact lineage behavior (`create`, `revise`, `fork`).
- Avoid breaking API/shape changes without documenting migration impact.
- Prefer explicit, deterministic behavior over magic.

## Development flow

1. Fork and clone
2. Create a feature branch
3. Run local checks
4. Open a PR

## Before opening a PR

Run:

```bash
npm run typecheck
npm run build
```

(Or `npm run audit` for both.)

## PR checklist

- [ ] Change is scoped and explained
- [ ] Checks pass locally
- [ ] README/docs updated if behavior changed
- [ ] Screenshots included for visible UI changes

## Commit style

Use clear subject lines (examples):
- `feat: add artifact provenance panel`
- `fix: handle missing kv token fallback`
- `docs: clarify env var precedence`

## Reporting bugs

Please include:
- expected behavior
- actual behavior
- reproduction steps
- environment details (`node`, OS, browser)

## Security issues

For vulnerabilities, please use responsible disclosure with maintainers instead of posting exploit details publicly.
