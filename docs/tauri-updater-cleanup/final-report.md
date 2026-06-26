# Tauri updater cleanup — final report

## Outcome

Reverted the closed-source-era Tauri auto-updater workarounds and restored the
standard public GitHub Releases updater path, matching current Tauri v2
guidance.

## Coordinates

- **Branch:** `alex/revert-closed-source-updater-hacks` (from `master`)
- **Commit:** `3b6d823` — *Revert closed-source updater hacks; use public GitHub Releases feed*
- **PR:** https://github.com/team-reflect/local-brain/pull/173

## Background (from git history)

The updater started clean and open-source-shaped:

- `47e87e6` / `939b087` **Add GitHub Releases updater** — static `latest.json`
  at `releases/latest/download/latest.json`, public `releases/download/...`
  asset URL, minisign pubkey.
- `695c2e8` **enable desktop updater support** — registered the
  `updater` + `process` plugins.

Then, to ship the *private* repo, the closed-source hacks landed:

- `813208a` (`b23ef99`/`4d53094`/`9398049`) **Add private GitHub updater feed**
  — `private_updates.rs` with an embedded PAT, the frontend binding, the
  controller fallback, and the `apiUrl`-based release manifest.
- `358ae22` **avoid updater fallback for current private release**.
- `038fec5` **accept null body/date in private updater metadata** — a schema
  patch needed only because the API path returned a different shape.

This change removes that private-repo layer; the later patches become moot.

## What changed

| File | Change |
| --- | --- |
| `apps/desktop/src-tauri/src/private_updates.rs` | **deleted** (PAT + GitHub API proxying) |
| `apps/desktop/src/lib/private-update.ts` / `.test.ts` | **deleted** (frontend binding) |
| `apps/desktop/src-tauri/src/lib.rs` | dropped `mod private_updates` + the `github_private_update_check` handler |
| `apps/desktop/src-tauri/Cargo.toml` | removed `reqwest`, `url`, `semver` (only used by the deleted command) |
| `Cargo.lock` | regenerated (−80 lines) |
| `apps/desktop/src/lib/update-controller.ts` | `checkPrivateGithubUpdate().catch(() => check())` → `check()` |
| `apps/desktop/src/lib/update-controller.test.ts` | dropped the private-feed mock + fallback test |
| `apps/desktop/scripts/release-macos.mjs` | `uploadUpdaterManifestForPrivateGitHub` (apiUrl, post-create upload) → `writeUpdaterManifest` (public `releases/download/<tag>/<archive>` URL, attached as a release asset) |
| `apps/desktop/scripts/release-macos.test.mjs` | manifest-URL expectation updated to the public download URL |

## Best-practice updater path that remains

- `tauri.conf.json` → `plugins.updater`:
  - `endpoints`: `https://github.com/team-reflect/local-brain/releases/latest/download/latest.json`
  - `pubkey`: committed minisign public key.
- `release-macos.mjs publish`: builds + signs + notarizes, writes `latest.json`
  with the public `releases/download/<tag>/<archive>.app.tar.gz` URL, and
  attaches DMG + `.app.tar.gz` + `.sig` + `latest.json` to the GitHub release.
- The app checks via `@tauri-apps/plugin-updater`'s `check()`, which fetches the
  static manifest and verifies the minisign signature before installing.

This is exactly the flow documented at https://v2.tauri.app/plugin/updater/ for
GitHub Releases distribution. No auth headers, PAT, or API proxying — those are
only needed for private update servers.

## Verification (run locally, all green)

| Check | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | pass (1 pre-existing unrelated `max-lines` warning in `packages/core/src/reports/getters.ts`) |
| Typecheck | `pnpm --filter @local-brain/desktop typecheck` | pass |
| JS/TS tests | `pnpm --filter @local-brain/desktop test` | 263 passed / 37 files |
| Rust check | `cargo check -p local-brain-desktop` | pass |
| Rust clippy | `cargo clippy -p local-brain-desktop --all-targets -- -D warnings` | pass |
| Rust tests | `cargo test -p local-brain-desktop` | 88 passed, 1 ignored |
| Format | `cargo fmt --all -- --check` | pass |

## Caveats

1. **Leaked PAT (action required).** The GitHub PAT that was embedded in
   `private_updates.rs` is removed from the working tree but **remains in git
   history**. It must be **revoked on GitHub** independently of this PR. No
   secret is introduced by this PR. History rewriting is out of scope.
2. **No full release build locally.** `pnpm tauri build` / a signed release was
   not executed here — it needs the Apple Developer ID certificate and the
   updater signing key, which are not available in this environment. The release
   script's manifest logic is covered by `release-macos.test.mjs`, and the
   broader build/clippy/test path runs in CI.
3. **Single-arch manifest** is unchanged pre-existing behavior: `latest.json`
   lists only the host architecture (documented in `docs/macos-distribution.md`).
