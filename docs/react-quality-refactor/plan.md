# React Quality Refactor — Plan

**Branch:** `codex/local-brain-react-quality-refactor`
**Base:** `origin/master` @ `f2828f2`
**Scope:** Frontend quality only (`apps/desktop/src`). No Rust refactor.

## Baseline assessment

The desktop frontend is already in good shape: typed discriminated-union router,
camelCase bridge layer, TanStack Query hooks, named exports, kebab-case files,
strict TypeScript, and a Vitest DOM suite (77 tests green at baseline). Most code
reads cleanly. This pass therefore targets a few genuinely high-leverage seams
rather than broad churn.

## Highest-risk / highest-leverage areas (repo-grounded)

1. **Duplicated modal overlays (a11y + DRY).** Three components hand-roll the
   identical scrim + Escape handling, with inconsistent focus management:
   - `components/command-palette.tsx` — scrim + arrow-nav, no focus restore.
   - `components/add-ai-provider-dialog.tsx` — `role=dialog`, manual focus save/restore.
   - `components/brain-dialog.tsx` — `role=dialog`, no focus trap, no focus restore.
   All copy `fixed inset-0 z-50 … bg-foreground/25 pt-[12vh] backdrop-blur-[1px]`.
   None trap focus or lock scroll. The design system explicitly says to use a
   shadcn/ui primitive for overlays/dialogs before hand-rolling; `radix-ui` (with
   `Dialog`) is already a dependency and `components/ui/{popover,dropdown-menu}.tsx`
   already follow this pattern.

2. **`surfaces/settings.tsx` (537 lines).** By far the largest file; bundles seven
   section components in one file, against the "one component per file" convention.
   `SemanticSearch` hand-rolls `bg-primary` / bordered buttons instead of the
   `Button` primitive (a design-system violation called out in `design-system.md`).

3. **Ask history menu (`surfaces/ask.tsx`).** A hand-rolled toggle dropdown with no
   outside-click or Escape close (only the toggle button dismisses it) — a real UX
   gap. The `Popover` primitive already solves this.

## Work items

| # | Change | Why | Risk |
|---|--------|-----|------|
| 1 | Add `components/ui/dialog.tsx` (radix shadcn-style primitive) | Canonical overlay; focus trap + restore + scroll lock + Escape, once | low |
| 2 | Refactor `add-ai-provider-dialog` + `brain-dialog` onto it | Remove 2 scrim copies; gain real a11y | low |
| 3 | Refactor `command-palette` onto it | Remove 3rd scrim copy; gain focus restore | med |
| 4 | Split `settings.tsx` → `surfaces/settings/*` (one component per file) | Convention + maintainability | low |
| 5 | `SemanticSearch` raw buttons → `Button` primitive | Design-system compliance | low |
| 6 | Ask history dropdown → `Popover` primitive | Outside-click/Escape close, a11y | low |
| 7 | Add `docs/frontend-architecture.md` | Durable orientation for future work | n/a |

## Acceptance criteria

- No change to user-visible behavior except the two fixed UX gaps (Ask menu
  outside-click/Escape close; dialog focus restore/trap).
- No `any` / `as any`; strict types preserved; no hook-order or stale-closure hazards.
- One component per file for the split settings sections; named exports; kebab-case.
- `git diff --check` clean.
- `pnpm check` (typecheck + oxlint + vitest) green.
- `pnpm --filter @local-brain/desktop build` green.
- `pnpm --filter @local-brain/desktop sidecar` green.
- New/updated Vitest DOM tests cover the changed behavior (dialog Escape/focus,
  Ask menu dismissal, settings section rendering).
- Branch pushed; non-draft PR opened against `master`.

## Out of scope

- Rust/native changes (only if required to keep the build green; documented if so).
- New major libraries (radix is already present).
- Visual redesign — visuals stay pixel-equivalent.
