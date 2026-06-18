# Status — Reflect graph picker → Local Brain brain picker

Branch: `codex/local-brain-reflect-graph-picker` · base `58c801f`.

## Phase

Plan complete. Implementing.

## Progress

- [x] Read AGENTS.md, docs, supervisor skill; mapped Local Brain + both Reflect refs.
- [x] Terminology decision: **Brain** (container) vs **Graph** (network viz).
- [x] plan.md written.
- [ ] Rust: brain registry + commands + DbState swap.
- [ ] Core: brains domain (schemas + IPC bindings).
- [ ] Desktop: brain-colors, BrainSwatch, query hooks.
- [ ] Desktop: brain switcher + dialog + chooser.
- [ ] Desktop: app-shell + App gating/remount + commands.
- [ ] Desktop: Settings → Brain section + diagnostics.
- [ ] Terminology audit across docs.
- [ ] Tests (Rust, core, DOM).
- [ ] Verification suite.
- [ ] final-report.md + PR.

## Notes / decisions

- Brain = one SQLite file; registry JSON in `<data_dir>/local-brain/brains.json`,
  Rust-owned with atomic writes + path guards.
- Real runtime switching via `DbState::swap`; frontend remounts keyed by brain path.
- Native OS file picker deferred (no dialog plugin); path-input dialog used meanwhile.

## Blockers

None.
