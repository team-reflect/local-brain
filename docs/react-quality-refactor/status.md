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

## Verification state (post-merge final)

Re-run on the tree after the `123ed10` (PR #53) merge:

- `git diff --check`: clean.
- `pnpm check` (typecheck + oxlint + vitest): pass — core 191 tests, desktop 76
  tests; skills has no tests.
- `pnpm --filter @local-brain/desktop build`: pass (2249 modules; only the
  pre-existing `install-model.ts` dual import and chunk-size warnings).
- `pnpm --filter @local-brain/desktop sidecar`: pass — staged
  `brain-aarch64-apple-darwin` (compiled the merged-in `brain-schema` 0008
  migration cleanly).
- No Rust/native source touched beyond merging current master, so dedicated cargo
  gates were not required; the sidecar compile covers the merged Rust changes.

## Follow-up (2026-06-18): shadcn/local primitive audit + latest-master merge

- Merged current `origin/master` @ `123ed10` (PR #53, first-class asset search)
  into the branch. Clean merge, no conflicts; no Ask/chat reintroduced. The
  command palette already labelled `asset` hits, so it stayed compatible.
- **shadcn/local primitive audit of the PR-changed frontend files** — all already
  use the right primitive; no code changes were needed:
  - Dialogs (`add-ai-provider-dialog`, `brain-dialog`) → `components/ui/dialog`
    primitive; their actions use `Button`.
  - `command-palette` → `Dialog` primitive.
  - Settings (`brain`, `semantic-search`) action controls → `Button`; `brain`'s
    color picker → `Popover` primitive. `general`/`skills`/`local-database`/
    `diagnostics` are static text, no controls.
- **Deliberate non-changes (changed files):** three raw `<button>`s remain because
  they are list/nav rows, not action buttons, and `Button`'s variants would make
  them worse: the Settings section rail tab (left-border `aria-current` indicator,
  `settings-surface.tsx`), the color-option rows inside the Brain color `Popover`
  (`brain.tsx`), and the command-palette result rows (keyboard-driven active
  highlight). These match the established list-row pattern (e.g. `brain-switcher`).
- **Out of PR scope (left untouched):** untouched master files still hand-roll some
  action buttons (`first-run` "Get started", and various nav/list/filter buttons in
  `today`/`tasks`/`network`/`memory-list`/`linked-records`/`citation-list`). Per the
  PR-#54 scope constraint these were not refactored here; converting the genuine
  action buttons among them to `Button` is a reasonable separate follow-up.
- PR #54 checks: Cursor Bugbot `success` on head `53d6d45`; no review comments.
  mergeStateStatus `CLEAN` / `MERGEABLE` before this merge.
- Re-ran all four gates on the merged tree (see below); all pass.

## Notes / decisions

- Used the `radix-ui` meta-package `Dialog` (already a dependency), matching the
  existing `components/ui/{popover,dropdown-menu}.tsx` pattern, per `design-system.md`.
- Behavior intentionally improved in one spot: dialogs now trap and restore focus
  and lock scroll. All other behavior preserved.
- Settings section components renamed to `*Settings` for self-describing named
  exports; the `model-keys` → AI providers alias was preserved.
