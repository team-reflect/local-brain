# React Quality Refactor — Final Report

## Result

A focused, behavior-preserving React/TypeScript quality pass over
`apps/desktop/src`. The frontend was already strong (typed router, camelCase
bridge, TanStack Query hooks, named exports, strict TS, Vitest DOM suite), so this
pass targeted a few high-leverage seams instead of broad churn.

- **Branch:** `codex/local-brain-react-quality-refactor`
- **Head SHA:** pending parent verification after merge with latest `master`
- **Base:** `origin/master` @ `f2828f2`; merged with current `origin/master` @
  `dd602e9`
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

The initial branch also improved the Ask history popover, but current `master`
removed the Ask / LLM chat surface in PR #52 before parent review. The merge
dropped that obsolete change and kept the still-valid Dialog/settings/docs work.

## Verification (all run on the final tree)

| Check | Result |
|-------|--------|
| `git diff --check` | clean |
| `pnpm check` (typecheck + oxlint + vitest) | passed before upstream merge; parent re-run pending |
| `pnpm --filter @local-brain/desktop build` | passed before upstream merge; parent re-run pending |
| `pnpm --filter @local-brain/desktop sidecar` | passed before upstream merge; parent re-run pending |

New DOM tests retained after the upstream merge: command-palette closes on
Escape; command-palette renders nothing while closed.

No Rust/native source was modified, so `cargo` checks were not required (the
sidecar step compiles the CLI as a build artifact and succeeded).

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
