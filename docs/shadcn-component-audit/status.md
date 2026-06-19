# shadcn/ui Component Audit — Status

## Summary

All planned work is complete and verified.

## Components Added (5 new files in `components/ui/`)

| File | Backing | Status |
|------|---------|--------|
| `ui/input.tsx` | native `<input>` + `controlClass` | ✅ Done |
| `ui/textarea.tsx` | native `<textarea>` + `controlClass` | ✅ Done |
| `ui/native-select.tsx` | native `<select>` + `controlClass` + lucide chevron | ✅ Done |
| `ui/checkbox.tsx` | `radix-ui` Checkbox primitive | ✅ Done |
| `ui/progress.tsx` | `radix-ui` Progress primitive | ✅ Done |

## Consuming Files Updated (10 files)

| File | Change |
|------|--------|
| `components/add-ai-provider-dialog.tsx` | `<input type="password">` → `<Input>`, `<select>` → `<NativeSelect>`, `<input type="checkbox">` → `<Checkbox>` |
| `components/brain-dialog.tsx` | `<input>` × 2 → `<Input>` |
| `components/model-combobox.tsx` | `<input list>` → `<Input>` (keeps `list=` attribute) |
| `components/project-create-dialog.tsx` | `<input>` → `<Input>`, `<textarea>` → `<Textarea>` |
| `surfaces/settings/brain.tsx` | `<input>` → `<Input>` |
| `surfaces/settings/model-download-progress.tsx` | hand-rolled `role="progressbar"` div → `<Progress>` |
| `surfaces/tasks.tsx` | `<input type="checkbox">` → `<Checkbox>` |
| `surfaces/graph.tsx` | `<input type="checkbox">` × N → `<Checkbox>` + `aria-label` |
| `surfaces/graph.dom.test.tsx` | Updated assertions: `.checked` → `getAttribute('aria-checked')` |
| `vitest.config.ts` | Added `setupFiles` for `ResizeObserver` polyfill |

## Infrastructure

| File | Purpose |
|------|---------|
| `src/test/setup.ts` | `ResizeObserver` stub for jsdom (Radix `Checkbox` uses it internally) |
| `components/ui/checkbox.dom.test.tsx` | Focused DOM tests: aria role, controlled state, stopPropagation |

## Verification

- `pnpm --filter @local-brain/desktop typecheck` — ✅ pass
- `pnpm --filter @local-brain/desktop test` — ✅ 86/86 pass
- `pnpm --filter @local-brain/desktop build` — ✅ 2260 modules, no errors
- `pnpm --filter @local-brain/desktop sidecar` — ✅ compiled, staged
- `git diff --check origin/master...HEAD` — ✅ no whitespace issues
- Parent verification: `pnpm check` — ✅ pass (monorepo typecheck, oxlint, all package tests)

## Deliberate Non-Changes

See `plan.md` for the full list. Key decisions:
- Button / Badge / StatusBadge / Alert — kept in `components/`; already the design-system layer
- Dialog / Popover / DropdownMenu — already shadcn/Radix wrappers in `ui/`
- Raw `<button>` for list rows, nav rows, filter toggles — intentional design idiom
- Command-palette search input — transparent/custom styling incompatible with Input defaults
