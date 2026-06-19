# Reflect Design System Migration — Plan / Status / Final Report

Migrate Local Brain's desktop UI from the retired warm-paper ("Picardo") styling to the
**Reflect Open / Reflect Local design system**: minimalist, dense, cool-grey with a
single indigo accent, shadcn/HSL-token friendly, a fixed ~260px sunken left sidebar, a
quiet command/search trigger, compact rows, restrained borders, and crisp Inter
typography. The product model and IA are unchanged — only the visual language moved.

## Status: complete

- Branch: `codex/local-brain-reflect-design-system`
- Base (stacked on): `codex/local-brain-05b-corrections` (PR #14, `bf4ebea`)
- Verification: `git diff --check` clean · `pnpm check` (typecheck + oxlint + 33 tests)
  pass · `pnpm --filter @local-brain/desktop build` succeeds · live preview screenshots
  captured (see `screenshots/`).

## Reference sources used

From the Reflect Open design-system package and desktop app:

- `reflect-open/design-system/readme.md`, `SKILL.md`, `styles.css`
- `reflect-open/design-system/tokens/{colors,fonts,typography,spacing}.css`
- `reflect-open/design-system/components/{buttons,data-display,forms}/*`
- `reflect-open/design-system/ui_kits/app/{AppShell,Sidebar,SearchModal,Views}.jsx`
- `reflect-open/apps/desktop/src/components/{ui,sidebar}/*`

## Plan and decisions

The existing app already used Tailwind v4 + shadcn-style HSL CSS variables and referenced
them through semantic utilities (`bg-secondary`, `text-muted-foreground`, `border-border`,
`bg-primary`, …). The highest-fidelity, lowest-risk port therefore kept the **token names**
and re-pointed their **values** to Reflect's palette, then refined the chrome where the
old idioms diverged from Reflect.

Key decisions:

1. **Palette → cool grey + indigo.** Tailwind cool-grey ramp for neutrals, indigo-600 as
   the sole saturated accent (indigo-500 in dark). Converted Reflect's hex ramps to HSL
   triplets so `hsl(var(--token))` and the `@theme inline` mapping keep working. White
   content surface on a faint cool app field; gray-50 sunken sidebar.
2. **Radius → 8px house value** (`--radius: 0.5rem`), giving sm 4 / md 6 / lg 8 / xl 12 —
   matching Reflect (was 6px).
3. **Typography → Inter + mono, no serif.** Reflect uses one sans family plus mono. Dropped
   `font-serif` from the brand mark and page titles (now sans semibold, tight tracking).
   Section/field labels changed from **mono-uppercase** to quiet **sentence-case medium
   grey** (Reflect never uppercases labels). Mono is reserved for metadata and shortcuts.
4. **Primitives for consistent variants.** Added `components/button.tsx` (primary /
   secondary / outline / ghost / destructive), `components/badge.tsx` (pill `Badge` +
   `StatusBadge` mapping status→tone once), and shared class strings in `lib/ui.ts`
   (`controlClass`, `keycapClass`, label/meta helpers). No `components/ui/` shadcn
   generation was needed; lucide-react was already present.
5. **App shell.** 260px sunken sidebar with an indigo brand mark, a quiet ⌘K search field,
   compact nav rows (active = grey wash + indigo icon), and the Settings gear pinned at
   the bottom. Topbar reduced to a quiet Search trigger.
6. **Scope discipline.** Updated `docs/design-system.md` and `docs/ui-direction.md` to the
   Reflect direction and fixed the one contradicting line in
   `docs/plans/architecture-conventions.md`. Historical `docs/plans/*` and vision docs that
   still mention "Picardo" were left untouched to avoid colliding with the parallel
   Plans 06–09 stack; they can be reconciled later.

## Files changed

Tokens / primitives:

- `apps/desktop/src/app/globals.css` — Reflect cool/indigo tokens (light + dark), 8px
  radius, Inter/mono fonts, subtle body tracking.
- `apps/desktop/src/lib/ui.ts` (new) — shared label/meta/input/keycap class strings.
- `apps/desktop/src/components/button.tsx` (new) — Button primitive.
- `apps/desktop/src/components/badge.tsx` (new) — Badge + StatusBadge.

Shell & components:

- `components/app-shell.tsx` — sunken 260px sidebar, brand, search field, nav, topbar.
- `components/command-palette.tsx` — soft scrim, elevated rounded-xl card, search icon,
  quiet group labels, rounded result rows.
- `components/page-head.tsx`, `section.tsx`, `data-list.tsx`, `empty-state.tsx`,
  `citation-list.tsx` — quiet labels, rounded-lg frames, sans titles.
Surfaces & detail:

- `surfaces/today.tsx`, `tasks.tsx`, `network.tsx`, `projects.tsx`, `settings.tsx`,
  `graph.tsx` — status badges, refined filters/labels, Button/input primitives, cool graph
  node palette.
- `surfaces/detail/task.tsx`, `detail/project.tsx` — status fields render `StatusBadge`.

Docs:

- `docs/design-system.md`, `docs/ui-direction.md` — rewritten to Reflect.
- `docs/plans/architecture-conventions.md` — one-line correction.
- `docs/reflect-design-system/final-report.md` (this file) + `screenshots/`.

## Verification

| Gate | Result |
| --- | --- |
| `git diff --check` | clean (exit 0) |
| `pnpm check` (typecheck + oxlint + vitest) | pass — 33 desktop tests green |
| `pnpm --filter @local-brain/desktop build` | success — 2060 modules, 26 KB CSS |
| Built-CSS token check | new indigo/cool tokens present; warm tokens absent |
| Live preview (`vite preview`) | renders cleanly; only console noise is `favicon.ico` 404 |

### Preview / screenshots

`vite preview` serves the production bundle. Because the app talks to a Tauri IPC bridge
for data, surfaces render their empty/loading states under a plain browser (no Tauri
runtime) — but the chrome, tokens, typography, and overlays render fully, which is what
this change touches. No blank/overlap regressions were observed and there were no runtime
JS errors.

- `screenshots/today.png` — sidebar + topbar + Today (empty states).
- `screenshots/command-palette.png` — the ⌘K command palette.

## Rebase caveat

This PR is stacked on `codex/local-brain-05b-corrections` and kept intentionally clean
against it. A separate worker is running Plans 06–09 in the main worktree and may touch
overlapping UI files (`globals.css`, `app-shell.tsx`, surfaces, detail pages). If that
stack lands first, this branch will need a rebase/reconciliation — favor these Reflect
tokens and primitives while preserving any new product behavior those plans add. The
parallel worker's branch/worktree was not modified.
