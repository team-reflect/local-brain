# Final Report — Adopt shared Dialog primitive for FirstRun

## Summary

FirstRun onboarding now uses the shared shadcn-style Dialog primitive
(`apps/desktop/src/components/ui/dialog.tsx`) instead of a hand-rolled overlay.
The custom fixed scrim, `role="dialog"`/`aria-modal` markup, and ref-driven Tab
focus trap are gone — Radix owns focus trap, focus restore, and scroll lock.

### Changes

- `components/ui/dialog.tsx` — added a `placement="center"` option to
  `DialogContent` (default remains the app's top alignment) so blocking centered
  surfaces compose without re-hand-rolling overlay chrome.
- `components/first-run.tsx` — rewritten on `Dialog` / `DialogContent` /
  `DialogTitle` / `DialogDescription`. Blocking gate preserved: `onOpenChange` is a
  no-op and Escape / pointer-outside / interact-outside are `preventDefault`-ed, so
  only the explicit actions (which flip the first-run flag and unmount the gate)
  close it. The `pushBlockingModal` guard is kept for global-shortcut suppression.
  Visual intent preserved: centered ~36rem panel, same icon/title/content/actions.
- `components/first-run.dom.test.tsx` — added coverage: accessible `dialog`
  role + title, Escape does not dismiss, "Get started" closes via the mutation
  path. Existing fresh-install / completed-flag / per-brain tests retained.

## Audit result

Only hand-rolled dialog on master was `first-run.tsx`. After this change, the
sole `role="dialog"`/`aria-modal`/`fixed inset-0` overlay code in the app is the
shared `ui/dialog.tsx` primitive. Other dialog consumers (command palette,
add-AI-provider, project-create, brain, network details) were already on the
primitive and are untouched. Non-dialog fixed UI (e.g. window drag regions) left
alone.

## Verification

- `git diff --check origin/master...HEAD` — clean (exit 0).
- `pnpm check` — typecheck + lint + test all pass (desktop: 23 files, 94 tests;
  first-run suite: 6 tests).
- `pnpm --filter @local-brain/desktop build` — succeeds (pre-existing chunk-size /
  dynamic-import warnings only).
- Rust untouched; no Rust gates required.

## Repo state

- Branch: `codex/local-brain-shadcn-dialog-primitives`
- Base: `origin/master` @ `21feb6b1b33e984012c72cf1800bd0d3a031c067`
- PR: https://github.com/maccman/local-brain/pull/72
- Commit (code + docs): `28e8d4214605fa274ed4581bcca930b6b759da7d`
- Final HEAD updated by the report-finalize commit below; see `git log`.
