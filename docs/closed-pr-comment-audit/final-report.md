# Closed PR comment audit — final report

## Summary

Audited every closed pull request in `maccman/local-brain` (#1–#21) and every
comment/review on them, comparing each Cursor Bugbot finding against current
`master` (`3137d12`). Of 16 distinct technical findings, **13 were real on
`master` and are fixed here**; 1 is deferred (real but minor, needs a schema
change), 1 is not applicable (the file never reached `master`), and 1 is a false
positive (the flagged behaviour is the intended, safer design).

- Closed PRs audited: **21** (all PRs; none open)
- Comment/review items triaged: **28** (2 author issue comments, 19 Bugbot review
  comments, 7 Bugbot review summaries)
- Distinct technical findings: **16** → **13 fixed**, 1 deferred, 1 N/A, 1 by design

## Exact fixes

| Area | File | Change |
|------|------|--------|
| Orphan Ask turns | `packages/core/src/ai/ask.ts` | Wrap `provider.generate()`; on failure persist an honest assistant turn (`answered:false`) instead of leaving the user message unanswered. |
| Ask draft loss | `apps/desktop/src/surfaces/ask.tsx` | Restore the draft in `catch` if the send fails. |
| CLI search | `apps/cli/src/commands/read.rs`, `…/commands/mod.rs` | Gate the name `LIKE` on FTS tokens (no more `%%`-matches-all); escape `\ % _` with `ESCAPE '\'` via new `to_like_pattern`; merge + rank + cap to a single `limit`. |
| Task bucketing | `apps/cli/src/commands/report.rs` | Add the `scheduled` bucket for future `scheduled_for`; rank it with `soon` in `plan_day` (matches core `bucketFor`). |
| Chunk parity | `apps/cli/src/text.rs` | Count chunk sizes in UTF-16 code units (JS `String.length`), not Unicode scalars; new emoji parity test. |
| Model key precedence | `apps/desktop/src/lib/ai/install-model.ts` | One shared `resolveProviderKey` (env-first escape hatch, then keychain) for both startup and live refresh; env override preserved on keychain failure. |
| Keychain errors | `apps/desktop/src-tauri/src/keychain.rs` | Distinguish `errSecItemNotFound` (exit 44 → no key) from real failures (locked/denied → `Err`) in `keychain_get`/`keychain_delete`. |
| Topbar Add | `apps/desktop/src/components/app-shell.tsx` | `variant="primary"` — the documented single indigo action. |
| First-run model copy | `apps/desktop/src/components/first-run.tsx` | Use `configured` (not `canRun`) and name the kill-switch case honestly. |
| First-run a11y | `apps/desktop/src/components/first-run.tsx`, `…/lib/commands/modal-guard.ts`, `…/lib/commands/use-shortcuts.ts` | `role="dialog"`/`aria-modal`, focus trap, and a blocking-modal guard that suppresses global shortcuts (incl. ⌘K) while the overlay is open. |

## Not changed (with reason)

- **Citation source-label mismatch (#15, Low):** real but a correct fix requires
  persisting the citation marker (schema change) and a deterministic read order;
  out of proportion to a Low cosmetic mismatch. Citations still open the right
  source.
- **Stray XML tags in `docs/current-state.md` (#20):** the file never merged to
  `master`; nothing to fix.
- **Palette needs alphanumeric tokens (#21):** the token requirement in
  `globalSearch`/`toMatchQuery` is deliberate and is what prevents the High
  `%%`-everything bug; reverting would reintroduce it.

## Commands run (verification)

```
git fetch origin --prune                         # branch == origin/master (3137d12)
git diff --check                                 # OK — no whitespace errors
pnpm check                                        # PASS — lint + typecheck + 119 core / 38 desktop tests
pnpm --filter @local-brain/desktop sidecar        # built brain-aarch64-apple-darwin (Tauri build prerequisite)
cargo fmt --all -- --check                        # OK
cargo check --workspace                           # OK
cargo test --workspace                            # OK (incl. new text.rs UTF-16 test); cli text 5/5
pnpm --filter @local-brain/desktop build          # built dist/ (2087 modules)
```

## Caveats

- `cargo check --workspace` initially failed with
  `resource path binaries/brain-aarch64-apple-darwin doesn't exist` until
  `pnpm --filter @local-brain/desktop sidecar` was run to stage the bundled CLI
  binary — this is the documented Tauri build prerequisite, not a code defect.
- The desktop Vite build prints a benign large-chunk warning and a static/dynamic
  dual-import note for `install-model.ts`; both pre-exist this change.
- A pre-existing `act(...)` warning in `first-run.dom.test.tsx` is emitted by the
  test harness; the test still passes.
- Keychain exit-code behaviour (44 = `errSecItemNotFound`) was verified on this
  macOS host; `keychain.rs` is `#[cfg(target_os = "macos")]` only.
