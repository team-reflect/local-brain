# Status — Reflect graph picker → Local Brain brain picker

Branch: `codex/local-brain-reflect-graph-picker` · base `58c801f`.

## Phase

Complete, plus Alex's follow-up correction applied. Pushed; PR #26 open against
master (https://github.com/maccman/local-brain/pull/26).

## Follow-up correction (2026-06-18)

Alex required two changes; both done:

1. **No JSON for durable state.** The Rust-owned `brains.json` registry was
   replaced with a dedicated SQLite database (`<app data dir>/registry.sqlite`):
   tables `brains` (catalogue) + `registry_meta` (active path). WAL-backed atomic
   upserts; a corrupt/non-SQLite file is moved aside (`.sqlite.corrupt`) and
   recreated. Runtime DB switching unchanged (real, via `DbState::swap`).
2. **Native dialog plugin installed.** Added `tauri-plugin-dialog` (Rust) +
   `@tauri-apps/plugin-dialog` (JS), `dialog:default` capability, and wired the
   brain create/open dialog to the native OS file picker (open) / save dialog
   (create) via `lib/native-dialog.ts`. The validated path field stays as an
   editable fallback. `reveal_brain` still uses the already-wired opener plugin.

Docs/comments/tests updated so no durable brain-picker state is described as JSON.
Re-ran the full verification suite (all green — see final-report.md).

## Progress

- [x] Read AGENTS.md, docs, supervisor skill; mapped Local Brain + both Reflect refs.
- [x] Terminology decision: **Brain** (container) vs **Graph** (network viz).
- [x] plan.md written.
- [x] Rust: brain registry + commands + DbState swap (+ tests).
- [x] Core: brains domain (schemas + IPC bindings) (+ test).
- [x] Desktop: brain-colors, BrainSwatch, query hooks.
- [x] Desktop: brain switcher + dialog + chooser.
- [x] Desktop: app-shell + App gating/remount + `go.brain` command.
- [x] Desktop: Settings → Brain section + Local database/Diagnostics updates.
- [x] Terminology audit across docs (architecture-conventions, ui-direction,
      design-system, launch/README).
- [x] Tests: Rust (registry + swap), core (IPC bindings), DOM (switcher, settings).
- [x] Verification suite (all green — see final-report.md).
- [ ] final-report.md (writing) + PR (next).

## Blockers

None.
