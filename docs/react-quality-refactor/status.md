# React Quality Refactor — Status

Baseline: `origin/master` @ `f2828f2`. Frontend typecheck clean; 77 Vitest tests
passing before any change.

## Progress

- [x] Repo read + plan written (`plan.md`).
- [x] (1) `components/ui/dialog.tsx` primitive (radix shadcn-style).
- [x] (2) `add-ai-provider-dialog` + `brain-dialog` on the primitive.
- [x] (3) `command-palette` on the primitive (+ Escape/closed tests).
- [x] (4) Split `settings.tsx` into `surfaces/settings/*` (one component per file).
- [x] (5) `SemanticSearch` raw buttons → `Button` primitive.
- [x] (6) Ask history dropdown → `Popover` primitive (+ dismissal test).
- [x] (7) `docs/frontend-architecture.md` (+ linked from `docs/README.md`).

## Verification state (final)

- `git diff --check`: clean.
- `pnpm check` (typecheck + oxlint + vitest): pass — 80 tests across packages
  (was 77; +3 new DOM tests).
- `pnpm --filter @local-brain/desktop build`: pass (only pre-existing chunk-size /
  dynamic-import warnings).
- `pnpm --filter @local-brain/desktop sidecar`: pass — staged
  `brain-aarch64-apple-darwin`.
- No Rust/native source touched, so cargo checks not required.

## Notes / decisions

- Used the `radix-ui` meta-package `Dialog` (already a dependency), matching the
  existing `components/ui/{popover,dropdown-menu}.tsx` pattern, per `design-system.md`.
- Behavior intentionally improved in two spots (both prior gaps): dialogs now trap
  and restore focus and lock scroll; the Ask history menu now closes on
  outside-click / Escape. All other behavior preserved.
- Settings section components renamed to `*Settings` for self-describing named
  exports; the `model-keys` → AI providers alias was preserved.
