# shadcn/ui Component Audit — Plan

## Goal

Audit the desktop React UI (`apps/desktop/src`) for hand-rolled primitives that
should be shadcn/ui components, and adopt shadcn-compatible primitives where they
remove real duplication or inconsistency — without disturbing Local Brain's
deliberate, documented design system (Reflect Open: dense, cool-grey, single
indigo accent).

## Context / constraints

- The design system (`docs/design-system.md`, `docs/frontend-architecture.md`) is
  explicit and intentional. It already ships token-themed in-repo primitives
  (`components/button.tsx`, `components/badge.tsx` + `StatusBadge`,
  `components/alert.tsx`) and shared control class strings in `lib/ui.ts`
  (`controlClass`, `sectionLabel`, `metaText`, `keycapClass`), plus three
  shadcn-style Radix wrappers in `components/ui/` (`dialog`, `popover`,
  `dropdown-menu`).
- `components.json` is configured (new-york, `ui = @/components/ui`,
  `lib = @/lib`, base color neutral, lucide). No `class-variance-authority` is
  installed; existing `ui/*` wrappers use `cn()` + the `radix-ui` umbrella package
  + `data-slot` attributes + `ReactNode` return types. New components must match
  that house style (no cva), not the upstream cva templates.
- React 19 → `ref` is passed as a normal prop (no `forwardRef`), matching current
  shadcn new-york source.
- The shadcn CLI is not run; the lockfile is supply-chain-pinned. Components are
  added manually in the existing `ui/*` style (all required Radix primitives are
  re-exported by the already-installed `radix-ui@^1.6.0` umbrella, so no new
  dependency is needed).

## Where the real duplication is (from the audit sweep)

Raw HTML controls styled inline, repeated across surfaces:

- **Text inputs** — `controlClass` reused in `brain-dialog`, `add-ai-provider`,
  `model-combobox`, `settings/brain`; **plus** `project-create-dialog` hand-rolls a
  *different* input class with its own `aria-invalid` error treatment. Two styles
  for the same control.
- **Textarea** — `project-create-dialog` hand-rolls one.
- **Native select** — `add-ai-provider` styles a raw `<select>` with `controlClass`.
- **Checkboxes** — three raw `<input type="checkbox">` with *two different* accent
  forms (`accent-primary` vs `accent-[hsl(var(--primary))]`) in `tasks`, `graph`,
  `add-ai-provider`.
- **Progress** — `model-download-progress` hand-rolls a `role="progressbar"` bar
  (determinate + indeterminate).

## Adoptions (what changes)

Add these to `apps/desktop/src/components/ui/` in the established style and adopt
them at every matching call site:

| Component | Backing | Replaces |
| --- | --- | --- |
| `Input` | native `<input>` | `controlClass` inputs + project-dialog's bespoke input (keeps `aria-invalid` error styling) |
| `Textarea` | native `<textarea>` | project-dialog textarea |
| `NativeSelect` | native `<select>` | add-provider `<select>` |
| `Checkbox` | `radix-ui` Checkbox | the three raw checkboxes (one consistent indigo style) |
| `Progress` | `radix-ui` Progress | model-download bar (determinate + indeterminate) |

`controlClass` stays the single styling source of truth; `Input`/`Textarea`/
`NativeSelect` compose it so the visual tone and sizing are byte-identical.

## Deliberate non-changes (documented in final report)

- **Button / Badge / StatusBadge / Alert** — already the design-system's
  token-themed primitives, referenced by path in the docs. They *are* the
  shadcn-equivalent layer (variant maps instead of cva); migrating them into
  `ui/` would be churn, break doc references, and risk visual regressions.
- **Label** — form fields already use the design-system `sectionLabel` class inside
  a native wrapping `<label>` (implicit, accessible association). Radix `Label`
  can't nest inside that and would split label styling in two. Kept.
- **Separator** — `dropdown-menu` already has its own; remaining dividers are
  structural borders on padded header/footer containers, not standalone rules.
- **Tooltip / Switch / Card / Skeleton** — no genuine call site (no hover
  tooltips, no on/off toggles, design system forbids default cards / decorative
  skeletons).
- **Command palette search input, list/table rows, nav rows, graph SVG/canvas** —
  correct raw-HTML/composite abstractions; shadcn would add noise.

## Acceptance criteria

1. New `ui/*` primitives match house style (cn, radix-ui umbrella, data-slot,
   ReactNode, ref-as-prop) and preserve sizing/tone.
2. Every matching call site adopts the new primitive; no raw styled input /
   textarea / select / checkbox / progress bar remains except the documented
   exceptions.
3. `pnpm check` (typecheck + oxlint + vitest) passes; existing DOM tests
   (settings progress a11y, brain dialog, add-provider) still pass.
4. Focused DOM test added for the consolidated Checkbox interaction.
5. `pnpm --filter @local-brain/desktop build` and `sidecar` succeed.
6. No Rust/core/db changes.

## Risks

- **Progress a11y regression** — `settings-surface.dom.test` asserts
  `role="progressbar"`, `aria-label`, and conditional `aria-valuenow`. Radix
  Progress preserves all three (omits `aria-valuenow` when indeterminate). Verify.
- **Checkbox DOM shape** — Radix Checkbox renders `role="checkbox"` (a button),
  not `<input>`. Row-click `stopPropagation` and `aria-label` must be preserved;
  `onChange` → `onCheckedChange`. Covered by a focused test.
- **Input ref** — `brain-dialog` / `project-create-dialog` rely on `inputRef`;
  `Input` forwards `ref` (React 19 prop).
