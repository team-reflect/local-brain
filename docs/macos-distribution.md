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

## Cutting a release (the rolling Release PR)

The version is declared in three places that must move together:
`apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, and the
`local-brain-desktop` entry in `Cargo.lock`.

Every push to `master` runs `.github/workflows/release-pr.yml`. When `master` has commits
after the current published tag, the workflow creates or updates one ready-for-review
`automation/release` pull request. Its single generated commit updates all three version
declarations, while its managed body groups every unreleased pull request into a
changelog. Human and bot text outside the managed markers is preserved.

Merging that Release PR is the release action. The workflow accepts publishing secrets
only after it verifies that the merged PR came from the same repository's fixed
`automation/release` branch, still contains its durable release markers, advances the
version, and changes exactly the three version files. It then passes the exact merge SHA
to the signed and notarized Release workflow. Later commits on `master` cannot slip into
that build.

The default target is the next patch for a stable version or the next `beta.N` for an
existing beta. To choose another target, dispatch **Actions -> Release PR -> Run
workflow**, or use `pnpm release:bump`, which validates the local `master` checkout and
dispatches the same workflow:

```bash
pnpm release:bump                # default patch bump: 0.2.0 -> 0.2.1
pnpm release:bump patch          # 0.2.0 -> 0.2.1   (also: minor, major)
pnpm release:bump beta           # increment an existing beta: 0.2.0-beta.1 -> 0.2.0-beta.2
pnpm release:bump stable         # drop the prerelease: 0.2.0-beta.3 -> 0.2.0
pnpm release:bump preminor       # open a new beta cycle: 0.2.0 -> 0.3.0-beta.1
pnpm release:bump 0.5.0-beta.1   # set an explicit version
pnpm release:bump --dry-run      # show the request without dispatching it
pnpm release:bump --tag-only     # recovery: push the tag for an already-merged bump
```

Local Brain releases from `master` only. A stable release reaches `releases/latest` and
auto-updates stable installs; a prerelease is published with `--latest=false`, so stable
installs ignore it. The local helper requires the GitHub CLI (`gh`), prints the request,
and asks for confirmation (skip with `--yes`). It does not edit files or merge the PR.

The generated branch and pull request use `GITHUB_TOKEN`, so their ordinary push and PR
events do not start other workflows. The maintainer explicitly dispatches `ci.yml` for
the generated commit instead. No PAT is stored. The repository's **Allow GitHub Actions
to create and approve pull requests** setting must remain enabled.

The publishing gate also looks up `ci.yml` by the generated head SHA and requires a
successful completed run. Merging before CI completes, or merging with red CI, fails
closed without using signing secrets; rerun the failed **Release PR** workflow after the
same head's CI passes.

If publishing fails before a draft release is created, rerun the failed Release workflow
so it keeps the original merge SHA. If a draft already exists, finish or delete that
draft before retrying because the publisher deliberately refuses to replace an existing
release. `--tag-only` is the narrow recovery path when the version bump merged but no
tag or release was created. It finds the exact first-parent commit that introduced the
current version with a forward transition, requires all three declarations to agree on
both sides of that transition, and tags that commit even if `master` has advanced. It
never tags newer code with an already-reviewed version.
The former `--direct` and `--no-tag` bypasses are intentionally retired: normal bumps
go through the rolling PR, while break-glass publishing uses **Actions -> Release** with
an exact ref.

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
macOS runner - the same pipeline as a local release, including DMG notarization, the
Gatekeeper checks, and the updater artifacts. The rolling Release PR calls it directly
with the verified merge SHA because tags created with `GITHUB_TOKEN` do not trigger a
second workflow. Manual recovery remains available from **Actions -> Release -> Run
workflow** (optionally provide an exact ref and tick *draft*), or by pushing the matching
`v<version>` tag. The publish preflights apply unchanged, so all three version
declarations must already agree on the released commit. After a successful direct tag
or non-draft manual release, the workflow dispatches Release PR maintenance again so
commits that landed during publishing are not left without a rolling PR.

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
