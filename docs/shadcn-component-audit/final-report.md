# shadcn/ui Component Audit — Final Report

## Branch

`codex/local-brain-shadcn-component-audit`

## Scope

Audited all React files under `apps/desktop/src` for hand-rolled HTML controls
that should be shadcn/ui–style components. The codebase already had excellent
design-system discipline (Button, Badge, Alert primitives; Dialog/Popover/
DropdownMenu wrappers), so the audit focused on **form controls** that were
styled with raw HTML + `controlClass`.

## Components Added

Five new components added to `apps/desktop/src/components/ui/`:

### `Input` (`ui/input.tsx`)
Native `<input>` wrapper that composites `controlClass` (bordered white field,
indigo focus ring) and adds `aria-invalid` error-state styling. Replaces raw
`<input className={controlClass}>` at five sites.

### `Textarea` (`ui/textarea.tsx`)
Same pattern as Input; defaults to `resize-none`. Replaces raw `<textarea>` in
`project-create-dialog`.

### `NativeSelect` (`ui/native-select.tsx`)
Native `<select>` with `controlClass` + `appearance-none` + an absolutely-
positioned lucide `ChevronDown` arrow (matching the design-system aesthetic,
replacing the OS default arrow). Replaces the bare `<select>` in
`add-ai-provider-dialog`.

### `Checkbox` (`ui/checkbox.tsx`)
Radix `Checkbox` primitive (from the installed `radix-ui` umbrella). Renders
`role="checkbox"` with an indigo fill and lucide `Check` indicator. Replaces
three `<input type="checkbox">` controls that each chose their own
`accent-*` color.

### `Progress` (`ui/progress.tsx`)
Radix `Progress` primitive. Handles determinate (`value` 0–100) and
indeterminate (`value` omitted/null — renders a pulse animation). Replaces the
hand-rolled `role="progressbar"` div in `model-download-progress`.

## Important Replacements

| Before | After | File |
|--------|-------|------|
| `<input className={controlClass}>` | `<Input>` | `brain-dialog` (×2), `brain.tsx`, `model-combobox`, `project-create-dialog` |
| `<input type="password" className={...}>` | `<Input type="password">` | `add-ai-provider-dialog` |
| `<select className={controlClass}>` | `<NativeSelect>` | `add-ai-provider-dialog` |
| `<input type="checkbox" className="accent-primary">` | `<Checkbox>` | `add-ai-provider-dialog`, `tasks`, `graph` (×N) |
| Hand-rolled progressbar div | `<Progress>` | `model-download-progress` |
| Inline class strings in `project-create-dialog` | `<Input>` + `<Textarea>` | `project-create-dialog` |

## Deliberate Non-Replacements

| Item | Reason |
|------|--------|
| `components/button.tsx` | Custom 5-variant primitive matches design system; shadcn's Button uses `cva` which isn't in the project |
| `components/badge.tsx` + `StatusBadge` | Domain-semantic tone mapping; no shadcn equivalent |
| `components/alert.tsx` | Clean 4-variant primitive; shadcn Alert adds icon+title structure unused here |
| `ui/dialog.tsx`, `ui/popover.tsx`, `ui/dropdown-menu.tsx` | Already proper shadcn/Radix wrappers |
| Raw `<button>` in list/nav rows | Design idiom: hover-wash interactive rows (tasks, network, sidebar, command palette) |
| Filter toggle `<button>` in `tasks.tsx` | Segment-filter idiom; not an action button |
| Color option `<button>` in brain settings popover | List-row inside popover; correct abstraction |
| `<input>` in `command-palette.tsx` | Transparent/borderless search input; Input's `controlClass` default would override it |

## Infrastructure Changes

- `vitest.config.ts`: Added `setupFiles: ['./src/test/setup.ts']`
- `src/test/setup.ts`: `ResizeObserver` no-op stub for jsdom (Radix Checkbox uses it internally via `@radix-ui/react-use-size`)
- `components/ui/checkbox.dom.test.tsx`: Focused DOM tests for accessible role, controlled checked state, and `stopPropagation` (the Tasks table pattern)
- `surfaces/graph.dom.test.tsx`: Updated filter-checkbox assertions from `.checked` (native input) to `getAttribute('aria-checked')` (Radix button)

## Verification Results

Verified on branch head before commit:

```
pnpm --filter @local-brain/desktop typecheck   → pass (0 errors)
pnpm --filter @local-brain/desktop test        → 86/86 pass (21 test files)
pnpm --filter @local-brain/desktop build       → ✓ 2260 modules, no errors
pnpm --filter @local-brain/desktop sidecar     → ✓ compiled + staged
git diff --check origin/master...HEAD          → no whitespace issues
```

## PR

_URL to be filled after push._
