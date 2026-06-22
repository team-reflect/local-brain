# macOS Distribution Builds

How to produce a signed, notarized macOS build of Local Brain for distribution outside
the Mac App Store.

```bash
pnpm release:macos setup     # once: store notarization credentials in the keychain
pnpm release:macos           # signed + notarized build, verified end to end
pnpm release:macos publish   # the above, then upload the DMG to a new GitHub release
```

The helper lives at `apps/desktop/scripts/release-macos.mjs` and is exposed as
`pnpm release:macos` from the repo root.

This release path intentionally does not configure Tauri updater artifacts yet. The
published GitHub Release contains the notarized DMG only.

## What you need

1. **A Developer ID Application certificate** in your login keychain. This certificate
   type, not "Apple Distribution", is required for distribution outside the Mac App
   Store, and only the Apple Developer Account Holder can create one at
   [developer.apple.com -> Certificates](https://developer.apple.com/account/resources/certificates).
   Confirm it is installed with:

   ```bash
   security find-identity -v -p codesigning
   ```

2. **Notarization credentials.** Prefer an App Store Connect API key in CI. For local
   releases, an Apple ID on the team with an app-specific password also works; create
   it at [account.apple.com](https://account.apple.com) -> Sign-In and Security ->
   App-Specific Passwords, then run `pnpm release:macos setup`. The setup command
   stores it in your login keychain as `local-brain-notary`.

3. **Xcode Command Line Tools** (`xcode-select --install`) for `notarytool` and
   `stapler`.

Nothing signing-related is committed to the repo. Contributors without the certificate
can still build unsigned bundles with plain `pnpm tauri build`.

## What `pnpm release:macos` does

1. Auto-detects the Developer ID identity from the keychain, unless
   `APPLE_SIGNING_IDENTITY` is set.
2. Loads notarization credentials from environment variables or the keychain item
   created by `setup`.
3. Runs `pnpm tauri build`, which stages the `brain` CLI sidecar and signs/notarizes
   the `.app` through Tauri.
4. Notarizes and staples the DMG itself. Tauri notarizes the `.app`; the DMG container
   needs its own ticket to avoid Gatekeeper friction after download.
5. Verifies everything with `codesign`, `spctl`, and `xcrun stapler`.

Bundles land in `target/release/bundle/macos/Local Brain.app` and
`target/release/bundle/dmg/Local Brain_<version>_<arch>.dmg`.

## Commands and flags

```bash
pnpm release:macos                 # build + notarize + verify (default)
pnpm release:macos setup           # store Apple ID + app-specific password locally
pnpm release:macos verify          # re-run checks on already-built bundles
pnpm release:macos publish         # build + notarize + verify, then create a GitHub release
pnpm release:macos publish --draft # same, but leave the release as a draft for review
pnpm release:macos --no-notarize   # signed-only build (Gatekeeper rejects it elsewhere)
```

## Cutting a release (`pnpm release:bump`)

The version is declared in three places that must move together:
`apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, and the
`local-brain-desktop` entry in `Cargo.lock`. `pnpm release:bump` edits all three,
commits the bump on a short-lived release branch, pushes that branch, opens and
immediately merges a PR back to `master`, then pushes the `v<version>` tag from the
merged commit. That tag push triggers the Release workflow.

```bash
pnpm release:bump           # 0.1.0 -> 0.1.1
pnpm release:bump minor     # 0.1.0 -> 0.2.0
pnpm release:bump major     # 0.1.0 -> 1.0.0
pnpm release:bump 0.5.0     # explicit stable version
pnpm release:bump --dry-run # show the plan, change nothing
pnpm release:bump --tag-only
```

Local Brain has no `next` or beta channel in this setup. The script refuses prerelease
versions and only cuts releases from `master`.

`--direct` keeps a direct-push path for maintainers with an explicit ruleset bypass.
With `--direct`, `--no-tag` bumps and pushes `master` without tagging. `--tag-only` is
a recovery path for a release PR that was merged without the tag push.

## Publishing to GitHub Releases

`pnpm release:macos publish` runs the full build above, then creates a GitHub release
tagged `v<version>` with the notarized DMG attached and generated release notes. It
requires the [GitHub CLI](https://cli.github.com) authenticated with `gh auth login`
for local runs. In CI, the workflow uses `GITHUB_TOKEN`.

Preflight checks run before the build:

- the working tree is clean and `HEAD` is on an `origin` branch;
- no release for `v<version>` exists yet;
- any existing `v<version>` tag on origin points at `HEAD`.

Pass `--draft` to create the release without publishing it, then review and publish it
from the GitHub UI.

## Releasing from CI

`.github/workflows/release.yml` runs `pnpm release:macos publish` on a GitHub-hosted
macOS runner. Trigger it from **Actions -> Release -> Run workflow** (tick *draft* to
review first), or by pushing the matching `v<version>` tag.

Create these repository Actions secrets under **Settings -> Secrets and variables ->
Actions**:

| Secret | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | Full identity string, for example `Developer ID Application: ... (TEAMID)` from `security find-identity -v -p codesigning` |
| `APPLE_CERTIFICATE` | The Developer ID certificate + private key: export a `.p12` from Keychain Access, then `base64 -i certificate.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password set on that `.p12` export |
| `APPLE_API_KEY` | App Store Connect API key ID, for notarization |
| `APPLE_API_ISSUER` | The API key's issuer UUID |
| `APPLE_API_KEY_CONTENT` | The `.p8` key file's content; the workflow writes it to disk as `APPLE_API_KEY_PATH` |

Apple ID notarization works instead of the API key: set `APPLE_ID` and
`APPLE_PASSWORD` (an app-specific password), plus `APPLE_TEAM_ID` if the signing
identity does not end in `(TEAMID)`.

No personal access token is needed. The release is created with the workflow's own
`GITHUB_TOKEN`.

## Troubleshooting

- **`no "Developer ID Application" certificate found`**: the cert is not in your login
  keychain, or it is the wrong type.
- **Notarization fails (`status: Invalid`)**: the script prints the notary log, which
  lists each offending file.
- **`rejected, source=Unnotarized Developer ID`**: signing worked, but the artifact has
  no notarization ticket; rerun without `--no-notarize`.
- **Notarization hangs**: Apple's service occasionally queues submissions for a long
  time. Check status with `xcrun notarytool history`.

## Current limitations

- Builds target the host architecture only. A universal build needs the
  `x86_64-apple-darwin` rustup target, a universal sidecar from
  `scripts/build-sidecar.mjs`, and `pnpm tauri build --target universal-apple-darwin`.
- No Tauri updater artifacts are produced yet.
