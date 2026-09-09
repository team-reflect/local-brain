# macOS Distribution Builds

How to produce a signed, notarized macOS build of Local Brain for distribution outside the
Mac App Store.

```bash
pnpm release:macos setup           # once: store notarization credentials in the keychain
pnpm release:macos setup-updater   # once: generate the auto-update signing keypair
pnpm release:macos                 # signed + notarized build, verified end to end
pnpm release:macos publish         # the above, then upload the DMG + updater artifacts to a new GitHub release
```

The helper lives at `apps/desktop/scripts/release-macos.mjs` and is exposed as
`pnpm release:macos` from the repo root.

## What you need

1. **A Developer ID Application certificate** in your login keychain. This certificate
   type (not "Apple Distribution", which is App Store only) is required for distribution
   outside the App Store, and only the Apple Developer **Account Holder** can create one,
   at [developer.apple.com -> Certificates](https://developer.apple.com/account/resources/certificates).
   Confirm it's installed with:

   ```bash
   security find-identity -v -p codesigning
   ```

2. **An Apple ID on the team with an app-specific password** for notarization. Create the
   password at [account.apple.com](https://account.apple.com) -> Sign-In and Security ->
   App-Specific Passwords, then run `pnpm release:macos setup`. The setup command stores
   it in your login keychain (item `local-brain-notary`) - the password never touches shell
   history or the repo.

3. **Xcode Command Line Tools** (`xcode-select --install`) for `notarytool` and `stapler`.

4. **The updater signing key** (for `publish`). Auto-update payloads are verified against
   the minisign public key committed in `tauri.conf.json` (`plugins.updater.pubkey`),
   distinct from Apple signing. `pnpm release:macos setup-updater` generates the keypair,
   stores the private key in your login keychain (item `local-brain-updater`), and prints the
   public key to commit. **Losing the private key strands every installed app** (they
   reject anything not signed with it), so back it up; rotating it only reaches users via
   a release signed with the old key that ships the new pubkey.

Nothing signing-related is committed to the repo: contributors without the certificate
can still build unsigned bundles with plain `pnpm tauri build`.

## What `pnpm release:macos` does

1. Auto-detects the Developer ID identity from the keychain and derives the team ID.
2. Loads notarization credentials (keychain item, or environment variables - see
   [Releasing from CI](#releasing-from-ci) below).
3. Runs `pnpm tauri build`, which stages the `brain` CLI sidecar, then signs inside-out
   (sidecar -> main binary -> `.app`) with hardened runtime, notarizes the `.app` via
   `notarytool`, staples the ticket, and builds + signs the DMG.
4. Notarizes and staples the **DMG** itself. Tauri only notarizes the `.app`; without its
   own ticket the DMG container fails `spctl --type open` and downloads can hit
   Gatekeeper friction.
5. Verifies everything: `codesign --verify --deep --strict`, Gatekeeper assessment of
   the app and DMG (`accepted` / `source=Notarized Developer ID`), and stapled tickets;
   it fails loudly if any check is off.

Bundles land in `target/release/bundle/macos/Local Brain.app` and
`target/release/bundle/dmg/Local Brain_<version>_<arch>.dmg`.

## Commands and flags

```bash
pnpm release:macos                 # build + notarize + verify (default)
pnpm release:macos setup           # store Apple ID + app-specific password in the keychain
pnpm release:macos verify          # re-run all checks on already-built bundles
pnpm release:macos publish         # build + notarize + verify, then create a GitHub release
pnpm release:macos publish --draft # same, but leave the release as a draft for review
pnpm release:macos --no-notarize   # signed-only build (runs locally; Gatekeeper rejects it elsewhere)
```

## Automatic releases after merging

Merging a PR into `master` starts CI. When CI succeeds, **Automatic release**
(`.github/workflows/auto-release.yml`) prepares and publishes a macOS release without
another PR or manual merge:

1. Read the current `master` commit and require successful CI for that exact source.
2. Choose the next patch version, or the next `beta.N` while on a beta.
3. Create a commit that changes only the desktop version in
   `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, and
   the `local-brain-desktop` entry in `Cargo.lock`. Fast-forward `master` to it.
4. Pass that immutable version commit SHA to the existing signed and notarized
   **Release** workflow, which publishes the DMG and updater artifacts.

The preparation job has no Apple or updater secrets. It executes trusted `master`
code, accepts only this repository's master CI runs, and reads no PR artifacts.
The publisher receives only the validated release SHA and the signing secrets it needs.
The version commit uses `GITHUB_TOKEN`, so it does not recursively trigger CI or another
release. There is no PAT and no generated Release PR. GitHub-generated release notes
still list the changes included in the release.

Releases are serialized through publication. Rapid merges can share one release:
every queued notification reconciles the latest `master` and checks that commit's CI,
so a superseded notification cannot publish untested newer code or lose a newer merge.
A merge that races the version commit causes the fast-forward update to fail; its own
CI completion retries preparation. The release build always checks out the exact
prepared SHA, even if `master` advances during notarization. Direct pushes and manually
rerun CI on `master` follow the same release path.

Automatic release is enabled when this workflow reaches `master`; that merge's successful
CI can publish immediately. It advances the checked-in version even if an older version
was never published, so the previously unpublished `0.1.18` does not block the next release.
Repository rules must allow `GITHUB_TOKEN` to fast-forward these version commits to
`master`; a denied update fails before signing or publishing.

### Choosing a version

The default is automatic. For a different version, use **Actions -> Automatic release
-> Run workflow** on `master`, or dispatch it from a clean, synchronized local `master`:

```bash
pnpm release:bump                # request the next patch (or next beta)
pnpm release:bump minor          # also: patch, major
pnpm release:bump beta           # increment an existing beta
pnpm release:bump stable         # promote an existing beta to stable
pnpm release:bump preminor       # start the next minor beta cycle
pnpm release:bump 0.5.0-beta.1   # request an explicit newer version
pnpm release:bump --dry-run      # print the request without dispatching it
```

**These requests publish; they do not create a PR for approval.** Master CI must
already have passed. If it is still pending or failed, the request fails and must be
submitted again once CI succeeds, so a custom version choice is never silently lost.
The local helper needs authenticated `gh`, prints the request, and asks for confirmation
(skip with `--yes`). A dispatch with no bump resumes a pending release or does nothing
when the version commit at `master` is already published. A version-only commit can
inherit CI from its tested ancestor only after every intervening commit is verified to
contain exactly the three version edits.

Stable releases reach `releases/latest` and are offered to installed apps. Prereleases
use `--latest=false` and do not reach stable installs.

### Failures and recovery

- Failed or pending master CI prevents a release. Rerun CI after fixing the failure.
- If publishing fails before creating a draft, rerun the failed publishing job in the
  original run to retain its exact release SHA. Rerunning preparation instead reconciles
  current `master`; if it still points to the prepared version commit, the same version
  and SHA are reused. An already-published version is a no-op.
- If a draft already exists, finish or delete that draft before retrying. Existing tags
  must match the exact release commit; the automation never replaces a published release
  or moves the stable updater feed back to an older version.
- **Actions -> Release -> Run workflow** with an exact ref remains the manual recovery
  path. `pnpm release:bump --tag-only` can also tag the exact version transition already
  committed on `master`, even if newer code has landed. All three declarations must
  agree, and the transition must change exactly the version files.

The former `--direct` and `--no-tag` bypasses remain retired.

## Publishing to GitHub Releases

`pnpm release:macos publish` runs the full build above, then creates a GitHub release
tagged `v<version>` (the `version` in `apps/desktop/src-tauri/tauri.conf.json`) with the
notarized DMG, the updater artifacts (`Local Brain.app.tar.gz` + `.sig`), and the
`latest.json` manifest attached, plus auto-generated release notes. Installed apps poll
`releases/latest/download/latest.json` (the committed `plugins.updater.endpoints` URL),
so publish requires the updater key and always attaches the manifest - a release without
it would stop existing installs from seeing any future updates. Beyond the signing
requirements, it needs the [GitHub CLI](https://cli.github.com) authenticated with
`gh auth login`.

All preflight checks run before the build, so a doomed publish fails in seconds rather
than after notarization:

- the working tree is clean and `HEAD` is on an `origin` branch - the release tag is
  created at that exact commit;
- no release for `v<version>` exists yet, and any existing `v<version>` tag on origin
  points at `HEAD` (`gh` reuses an existing tag, which would release the wrong commit).
  Publishing a new release means bumping `version` in `tauri.conf.json` first (keep
  `src-tauri/Cargo.toml` in step).

The publisher creates and fills a draft release first, then verifies that every payload
URL in `latest.json` exactly matches the eventual tagged URL for an asset reported by
GitHub before making the release visible. Draft asset URLs use a temporary `untagged-*`
segment, so validation replaces only that segment while preserving GitHub's exact repo
and filename. GitHub rewrites spaces in uploaded asset names to dots, so this check keeps
a filename mismatch from replacing the working `releases/latest` feed. Pass
`--draft` to stop after validation and leave the release unpublished for review in the
GitHub UI.

## Pre-releases

When the version in `tauri.conf.json` has a prerelease suffix (for example
`0.2.0-beta.1`), `publish` creates a GitHub **pre-release** and passes
`--latest=false`. The committed updater endpoint uses
`releases/latest/download/latest.json`, so stable installs do not see pre-releases. A
dedicated beta updater channel is future work.

## Releasing from CI

`.github/workflows/release.yml` runs `pnpm release:macos publish` on a GitHub-hosted
macOS runner, including DMG notarization, Gatekeeper checks, and updater artifacts.
Automatic release calls it directly with the exact prepared version SHA because
`GITHUB_TOKEN` commits and tags do not trigger another push workflow. The reusable
publisher needs only `contents: write`; no nested job requests broader Actions
permissions. Manual recovery remains available from **Actions -> Release -> Run
workflow** (provide an exact ref and optionally tick *draft*), or by pushing the matching
`v<version>` tag. All version declarations must already agree on the released commit.

The script reads all signing material from environment variables, which take
precedence over the keychain (exporting them works for local releases too); the
workflow wires them from repository Actions secrets of the same names. Create these
under **Settings -> Secrets and variables -> Actions**:

| Secret | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | Full identity string, e.g. `Developer ID Application: ... (TEAMID)` - from `security find-identity -v -p codesigning` |
| `APPLE_CERTIFICATE` | The Developer ID certificate + private key: export a `.p12` from Keychain Access, then `base64 -i certificate.p12`. Tauri imports it into a temporary keychain on the runner |
| `APPLE_CERTIFICATE_PASSWORD` | The password set on that `.p12` export |
| `APPLE_API_KEY` | App Store Connect API key ID, for notarization (preferred in CI - not tied to a personal Apple ID) |
| `APPLE_API_ISSUER` | The API key's issuer UUID |
| `APPLE_API_KEY_CONTENT` | The `.p8` key file's content; the workflow stages it on disk and sets `APPLE_API_KEY_PATH`, the variable the script reads |
| `TAURI_SIGNING_PRIVATE_KEY` | The updater private key: `security find-generic-password -s local-brain-updater -w \| base64 --decode` |

Notes:

- Apple ID notarization works instead of the API key: set `APPLE_ID` +
  `APPLE_PASSWORD` (an app-specific password), plus `APPLE_TEAM_ID` if the signing
  identity doesn't end in `(TEAMID)`.
- Leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset: the key has no password, GitHub
  rejects empty-string secrets, and the workflow defaults it to empty. (Locally,
  `TAURI_SIGNING_PRIVATE_KEY_PATH` also works in place of the key content.)
- No PAT is needed - the release is created with the workflow's own `GITHUB_TOKEN`.

The workflow verifies the secrets before building, so a misconfigured runner fails in
seconds rather than after the build and notarization. See the
[Tauri macOS signing docs](https://v2.tauri.app/distribute/sign/macos/) for background
on the runner keychain setup.

## Troubleshooting

- **`no "Developer ID Application" certificate found`** - the cert isn't in your *login*
  keychain, or it's the wrong type. An invalid/incomplete cert won't show up in
  `security find-identity` at all.
- **Notarization fails (`status: Invalid`)** - the script automatically prints the notary
  log, which lists each offending file. Common cause: a binary that wasn't signed with
  hardened runtime.
- **`rejected, source=Unnotarized Developer ID`** - signing worked but the artifact has no
  notarization ticket; rerun without `--no-notarize`.
- **Notarization hangs** - Apple's service occasionally queues submissions for a long
  time; check status with `xcrun notarytool history --apple-id <id> --team-id <team>`.

## Current limitations

- Builds target the host architecture only (Apple Silicon in practice). A universal
  build needs the `x86_64-apple-darwin` rustup target, a universal sidecar from
  `scripts/build-sidecar.mjs`, and `pnpm tauri build --target universal-apple-darwin`.
- The iOS project template (`src-tauri/ios.project.yml`) still uses the pre-rename bundle
  identifier and needs its own provisioning pass.
- `latest.json` only lists the host architecture, so auto-update serves the arch that was
  built (Apple Silicon in practice); the universal-build work above lifts both limits.
