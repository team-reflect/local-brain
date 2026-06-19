# React Quality Refactor — Final Report

## Result

A focused, behavior-preserving React/TypeScript quality pass over
`apps/desktop/src`. The frontend was already strong (typed router, camelCase
bridge, TanStack Query hooks, named exports, strict TS, Vitest DOM suite), so this
pass targeted a few high-leverage seams instead of broad churn.

- **Branch:** `codex/local-brain-react-quality-refactor`
- **Verified merge SHA:** latest-master merge resolution; any later tip commit is
  report metadata only
- **Base:** `origin/master` @ `f2828f2`; merged with current `origin/master` @
  `123ed10` (PR #53 asset search; an earlier merge took `dd602e9`)
- **PR:** https://github.com/maccman/local-brain/pull/54 (non-draft, open)
- **Worktree:** clean

## Changed areas

1. **Shared `Dialog` primitive (a11y + DRY).** New
   `apps/desktop/src/components/ui/dialog.tsx` — a shadcn-style `radix-ui` wrapper
   matching the existing `popover.tsx` / `dropdown-menu.tsx`. The command palette,
   Add-AI-provider dialog, and brain dialog each hand-rolled the same scrim, Escape
   handling, and ad-hoc focus code (none trapped/restored focus or locked scroll).
   All three now use the primitive and get focus trap, focus restore on close,
   scroll lock, and consistent outside-click/Escape dismissal.

2. **Settings split.** `surfaces/settings.tsx` (537 lines) → `surfaces/settings/`:
   `general.tsx`, `brain.tsx`, `semantic-search.tsx`, `local-database.tsx`,
   `skills.tsx`, `diagnostics.tsx`, a `settings-surface.tsx` shell, shared
   `format.ts` helpers, and a barrel `index.ts`. One component per file, per repo
   convention. Section components renamed to self-describing `*Settings` named
   exports; the `model-keys` → AI-providers alias was preserved. The two settings
   DOM tests moved alongside their components.

3. **Design-system compliance.** The Semantic search section's hand-rolled
   `bg-primary` / bordered buttons now use the `Button` primitive (Enable →
   `primary`, Backfill → `primary`, Rebuild → `outline`, Disable → `ghost`).

4. **Docs.** New `docs/frontend-architecture.md` (layering, bridge→queries
   pipeline, overlay/component conventions, commands/shortcuts, testing), linked
   from `docs/README.md`. Plus `plan.md` / `status.md` / this report.

### Follow-up: shadcn/local primitive audit (2026-06-18)

A second pass audited every PR-changed frontend file for hand-rolled UI that
should use a shadcn/local primitive (`Button`, `Dialog`, `Popover`,
`DropdownMenu`, `components/ui/*`). The result was **no further code changes
needed** — the refactor above had already converted them:

- Both dialogs and the command palette use the `Dialog` primitive; dialog actions
  use `Button`; the Brain color picker uses `Popover`; Settings action controls
  use `Button`.
- Three raw `<button>`s in changed files were deliberately left as-is because they
  are list/nav rows, not action buttons — forcing `Button`'s variants on them
  would degrade them: the Settings section rail tab (left-border `aria-current`
  indicator), the Brain color-option rows inside the `Popover`, and the
  command-palette result rows (keyboard-driven active highlight). These follow the
  app's existing list-row idiom (e.g. `brain-switcher`).
- Untouched `master` files outside PR #54's diff still hand-roll a few action
  buttons (notably `first-run`'s "Get started", plus nav/filter/list buttons in
  `today`/`tasks`/`network`/`memory-list`/`linked-records`/`citation-list`). They
  were left untouched to keep this PR scoped; converting the genuine action buttons
  among them to `Button` is a clean separate follow-up.

The branch was also merged up to current `origin/master` @ `123ed10` (PR #53
first-class asset search) — clean merge, no conflicts, no Ask/chat reintroduced.

The initial branch also improved the Ask history popover, but current `master`
removed the Ask / LLM chat surface in PR #52 before parent review. The merge
dropped that obsolete change and kept the still-valid Dialog/settings/docs work.

## Verification (all run on the final tree)

| Check | Result |
|-------|--------|
| `git diff --check` | clean |
| `pnpm check` (typecheck + oxlint + vitest) | pass after `123ed10` merge — core 191, desktop 76; skills no tests |
| `pnpm --filter @local-brain/desktop build` | pass after `123ed10` merge — 2249 modules; existing Vite warnings only |
| `pnpm --filter @local-brain/desktop sidecar` | pass after `123ed10` merge — staged `brain-aarch64-apple-darwin` |

New DOM tests retained after the upstream merge: command-palette closes on
Escape; command-palette renders nothing while closed.

No Rust/native source was modified by this refactor. The latest-master merge
brings upstream Rust changes into the branch history, and the sidecar step
successfully compiled the CLI build artifact.

## Behavior changes

One intentional fix, a prior gap:

- Dialogs now trap and restore focus and lock background scroll.

Everything else is visually and behaviorally equivalent.

## Caveats

- A full Tauri browser/UX pass was not feasible in this environment: the app's
  `invoke` bridge has no browser fallback, so a plain `vite dev` would stall on
  brain resolution. Verification relied on the Testing Library DOM suite, which
  renders the real components against an in-memory fake bridge.
- The Vite build still emits the pre-existing chunk-size (>500 kB) and
  static/dynamic dual-import warnings for `lib/ai/install-model.ts`. These predate
  this work and were left as-is to keep the pass focused; code-splitting is a
  reasonable follow-up.
- During parent review, `master` advanced with PR #52 removing Ask / LLM chat.
  The branch was merged with current `master`; the obsolete Ask-history change was
  dropped and the still-valid Dialog/settings/docs work was kept.
