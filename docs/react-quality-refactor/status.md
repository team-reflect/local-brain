# React Quality Refactor — Status

Baseline: `origin/master` @ `f2828f2`. Frontend typecheck clean; 77 Vitest tests
passing before any change. The branch was later merged with `origin/master` @
`dd602e9`, which removed the Ask / LLM chat surfaces.

## Progress

- [x] Repo read + plan written (`plan.md`).
- [x] (1) `components/ui/dialog.tsx` primitive (radix shadcn-style).
- [x] (2) `add-ai-provider-dialog` + `brain-dialog` on the primitive.
- [x] (3) `command-palette` on the primitive (+ Escape/closed tests).
- [x] (4) Split `settings.tsx` into `surfaces/settings/*` (one component per file).
- [x] (5) `SemanticSearch` raw buttons → `Button` primitive.
- [x] (6) `docs/frontend-architecture.md` (+ linked from `docs/README.md`).
- [x] Reconciled the branch with the upstream Ask removal; obsolete Ask-history
  changes/tests were dropped.

## Verification state (final)

- `git diff --check`: clean.
- `pnpm check` (typecheck + oxlint + vitest): pass before upstream merge — 80
  tests across packages. Re-run pending after the `dd602e9` merge.
- `pnpm --filter @local-brain/desktop build`: pass before upstream merge.
  Re-run pending after the `dd602e9` merge.
- `pnpm --filter @local-brain/desktop sidecar`: pass before upstream merge.
  Re-run pending after the `dd602e9` merge.
- No Rust/native source touched, so cargo checks not required.

## Notes / decisions

- Used the `radix-ui` meta-package `Dialog` (already a dependency), matching the
  existing `components/ui/{popover,dropdown-menu}.tsx` pattern, per `design-system.md`.
- Behavior intentionally improved in one spot: dialogs now trap and restore focus
  and lock scroll. All other behavior preserved.
- Settings section components renamed to `*Settings` for self-describing named
  exports; the `model-keys` → AI providers alias was preserved.
