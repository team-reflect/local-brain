# Tauri updater cleanup — status

**State:** complete — implemented, verified, branch pushed, PR opened.

## Done

- [x] Read repo: pnpm monorepo, Tauri v2, plugin-updater `^2.10.1`.
- [x] Audited git history for updater-related commits (#143, #153, #157, #163, #167).
- [x] Confirmed best practice against official Tauri v2 updater docs.
- [x] Branch `alex/revert-closed-source-updater-hacks` created from `master`.
- [x] Removed `private_updates.rs`, `private-update.ts`, `private-update.test.ts`.
- [x] Unregistered the module/command in `lib.rs`.
- [x] Dropped unused `reqwest`/`url`/`semver` from `Cargo.toml`; regenerated `Cargo.lock` (−80 lines).
- [x] Restored `update-controller.ts` to plain `check()` (+ test cleanup).
- [x] Restored `release-macos.mjs` to public `releases/download/<tag>/<archive>` manifest URL.
- [x] Updated `release-macos.test.mjs` expectation.
- [x] Verified (see final-report.md).

## Verification summary (all green)

| Check | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | pass (1 pre-existing unrelated `max-lines` warning) |
| Typecheck | `pnpm --filter @local-brain/desktop typecheck` | pass |
| JS/TS tests | `pnpm --filter @local-brain/desktop test` | 263 passed / 37 files |
| Rust check | `cargo check -p local-brain-desktop` | pass |
| Rust clippy | `cargo clippy -p local-brain-desktop --all-targets -- -D warnings` | pass |
| Rust tests | `cargo test -p local-brain-desktop` | 88 passed, 1 ignored |
| Format | `cargo fmt --all -- --check` | pass |

## Blockers

None.

## Outstanding (out of scope for this PR — requires human action)

- **Revoke the leaked GitHub PAT.** The token embedded in the now-deleted
  `private_updates.rs` is still present in git history and must be revoked on
  GitHub. Purging it from history is a separate coordinated force-push.
- Full `pnpm tauri build` / signed release was not run locally (requires Apple
  Developer ID cert + updater signing key, which are not available in this
  environment). The release path is exercised by the unit tests and CI.
