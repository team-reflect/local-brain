# Plan — Adopt the shared Dialog primitive for FirstRun

## Objective

Replace the last hand-rolled dialog (`first-run.tsx`) with the repo's shadcn-style
`ui/dialog.tsx` primitive, so all app dialogs share one Radix-backed
focus-trap / scroll-lock / focus-restore implementation.

## Audit (current master)

`rg` for `role="dialog"`, `aria-modal`, and `fixed inset-0`:

- `components/ui/dialog.tsx` — the shared primitive (keep).
- `components/first-run.tsx` — the only remaining hand-rolled dialog (migrate).

Existing primitive consumers (unchanged): command palette, add-AI-provider dialog,
project-create dialog, brain dialog, network details. Non-dialog fixed UI (window
drag regions, etc.) left alone.

## Approach

1. Extend the primitive minimally: add a `placement="center"` option to
   `DialogContent` so a blocking, vertically-centred surface composes cleanly
   instead of re-hand-rolling overlay chrome. Default stays top-aligned.
2. Rewrite `FirstRun` on `Dialog` / `DialogContent` / `DialogTitle` /
   `DialogDescription`. Delete the custom overlay markup and the ref-driven Tab
   focus trap (Radix owns focus). Keep the `pushBlockingModal` guard for global
   shortcut suppression.
3. Keep it a blocking gate: `onOpenChange` is a no-op and Escape /
   pointer-outside / interact-outside are `preventDefault`-ed, so only the
   explicit "Get started" / "Set up an AI provider" actions (which flip the
   first-run flag and unmount the gate) close it.
4. Preserve visual intent: centered ~36rem panel, same icon/title/content/actions,
   no new copy.

## Acceptance criteria

- No hand-rolled dialog (`role="dialog"`/`aria-modal`/focus-trap overlay) left
  except the shared primitive.
- FirstRun uses `components/ui/dialog.tsx`.
- Existing dialog users keep layout/keyboard behaviour.
- Branch committed, pushed, PR opened against master.

## Risks / caveats

- Visual: panel surface moves from `bg-card`/`shadow-xl` to the primitive's
  `bg-popover`/elevated shadow — consistent with every other dialog, negligible.
- jsdom: outside-click dismissal is awkward to simulate reliably; Escape
  non-dismissal is tested instead.

## Verification

- `git diff --check origin/master...HEAD`
- `pnpm check` (typecheck + lint + test)
- `pnpm --filter @local-brain/desktop build`
