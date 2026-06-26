# Tauri updater cleanup — plan

## Goal

`team-reflect/local-brain` used to be a **private** repository. To make the
Tauri auto-updater work against a private GitHub repo, the project grew a set of
workarounds: a Rust command that fetched the release manifest through the
authenticated GitHub API using an **embedded personal access token**, a
frontend wrapper that called it, a fallback chain in the update controller, and
a release script that rewrote `latest.json` to point at GitHub API asset URLs.

The repo is now **public**, so the standard Tauri updater path works directly:
a static `latest.json` served from
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`, with
the payload verified against the committed minisign public key. This change
reverts the private-repo hacks and restores that straightforward path.

## Source of truth

Official Tauri v2 updater docs (fetched 2026-06-25):

- https://v2.tauri.app/plugin/updater/ — confirms the public GitHub Releases
  endpoint pattern, the `latest.json` schema (`version`, `platforms.<os-arch>.{url,signature}`,
  optional `notes`/`pub_date`), `bundle.createUpdaterArtifacts`, and that **auth
  headers / proxies are only needed for private servers** — exactly the code
  being removed.
- https://v2.tauri.app/reference/environment-variables/ — `TAURI_SIGNING_PRIVATE_KEY`
  / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (kept; legitimate signing).

## What the closed-source era added (to revert)

Introduced mainly in `Add private GitHub updater feed (#157)` (`813208a`) with
follow-ups `#163` (`358ae22`) and `#167` (`038fec5`):

1. `apps/desktop/src-tauri/src/private_updates.rs` — a `github_private_update_check`
   Tauri command that hit `api.github.com/.../releases/latest`, discovered the
   `latest.json` asset, and re-pointed the updater at the API asset URL with
   `Authorization: Bearer <PAT>` headers. **Contained a hardcoded GitHub PAT.**
2. `apps/desktop/src/lib/private-update.ts` (+ test) — frontend binding to that
   command, with a `nullish` schema patch (`#167`) to tolerate the API shape.
3. `apps/desktop/src/lib/update-controller.ts` — `checkPrivateGithubUpdate().catch(() => check())`
   fallback instead of plain `check()`.
4. `apps/desktop/scripts/release-macos.mjs` — `uploadUpdaterManifestForPrivateGitHub`
   wrote `latest.json` with `apiUrl` (authenticated API asset URLs) and uploaded
   it after release creation, instead of the public `releases/download/...` URL.
5. `apps/desktop/src-tauri/Cargo.toml` — `reqwest`, `url`, `semver` deps added
   solely for the private command.

## What stays (legitimate, not a hack)

- `plugins.updater.pubkey` + `endpoints` in `tauri.conf.json` — already the
  public `releases/latest/download/latest.json` URL.
- minisign signing via `TAURI_SIGNING_PRIVATE_KEY` in `release-macos.mjs` /
  `release.yml`.
- Apple signing/notarization flow.
- The `updater`/`process` Tauri plugins and the `update-controller` state machine.

## Steps

1. Delete `private_updates.rs`, `private-update.ts`, `private-update.test.ts`.
2. Unregister the module + command in `lib.rs`.
3. Drop the now-unused `reqwest`/`url`/`semver` crates from `Cargo.toml`;
   regenerate `Cargo.lock`.
4. Restore `update-controller.ts` to a plain `check()` call (+ test cleanup).
5. Restore `release-macos.mjs` to write `latest.json` with the public download
   URL and attach it as a release asset (no post-create authenticated upload).
6. Update `release-macos.test.mjs` expectation to the public URL.
7. Verify: node typecheck/lint/test, rust clippy/test, release-script tests.
8. **Flag the leaked PAT for revocation** (it remains in git history).

## Security note

The embedded PAT in `private_updates.rs` is removed from the working tree but
**still exists in git history** (commits `b23ef99`/`813208a` onward). It must be
**revoked** on GitHub regardless of this PR. This PR does not (and cannot) purge
git history; doing so is a separate, coordinated force-push operation.
