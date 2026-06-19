# React Quality Refactor — Status

Baseline: `origin/master` @ `f2828f2`. Frontend typecheck clean; 77 Vitest tests
passing before any change.

## Progress

- [x] Repo read + plan written (`plan.md`).
- [ ] (1) `components/ui/dialog.tsx` primitive.
- [ ] (2) `add-ai-provider-dialog` + `brain-dialog` on the primitive.
- [ ] (3) `command-palette` on the primitive.
- [ ] (4) Split `settings.tsx` into `surfaces/settings/*`.
- [ ] (5) `SemanticSearch` raw buttons → `Button`.
- [ ] (6) Ask history dropdown → `Popover`.
- [ ] (7) `docs/frontend-architecture.md`.

## Verification state

- Baseline `pnpm --filter @local-brain/desktop typecheck`: pass.
- Baseline `pnpm --filter @local-brain/desktop test`: 77 passed.

## Notes / decisions

- Using the `radix-ui` meta-package `Dialog` (already a dependency), matching the
  existing `components/ui/{popover,dropdown-menu}.tsx` pattern, per `design-system.md`.
