# Local Brain — Launch Checklist & Release Gates

Release gates (not polish): accessibility, performance, privacy/model-boundary,
and native signing/notarization. This file is the launch smoke checklist plus the
gate decisions. Status reflects the alpha build produced on this host.

## Packaging status (this host)

| Item | Status |
| --- | --- |
| `pnpm tauri build` compiles the app | ✅ `Built application … target/release/local-brain-desktop` |
| macOS `.app` bundle produced | ✅ `target/release/bundle/macos/Local Brain.app` |
| `brain` sidecar embedded + runnable | ✅ `Contents/MacOS/brain` → `brain 0.1.0` |
| App identity | ✅ `app.localbrain.desktop` v0.1.0 |
| `.dmg` bundle | ⚠️ failed — `bundle_dmg.sh` drives Finder via AppleScript and needs a GUI/login session; not available in this headless build. The `.app` is the runnable artifact; produce the DMG on a developer workstation. |
| Code signing / notarization | ⏳ deferred (unsigned alpha — see below) |

## First-run / launch smoke checklist

Run against a clean brain root (e.g. `BRAIN_ROOT=$(mktemp -d)`).

- [ ] First run shows the brain folder chooser before any database is opened.
- [ ] Selecting a folder creates `brain.sqlite`, `assets/`, and `.local-brain/`.
- [ ] Welcome appears after a brain opens; "Get started" dismisses it once.
- [ ] Import a document and an interaction (paste + file path).
- [ ] Extraction: with a AI provider set, a meeting yields people/org/task/memory;
      without, capture still works (extraction no-ops).
- [ ] Browse Today, Tasks, Network (Graph/People/Orgs), and Projects.
- [ ] Search (⌘K) finds records by name and full text.
- [ ] Citations open the exact document/interaction.
- [ ] `brain` CLI works with the app closed: `add`, `search`, `today`,
      `report daily`, `tasks plan-day`, `relationships followups`, `graph`, `show`.
- [ ] A Codex daily automation updates records and produces a report + todo list.
- [ ] `brain doctor` / Settings → Diagnostics report setup clearly.

## Accessibility gate

- [x] Visible keyboard focus ring on all interactive elements (`:focus-visible`,
      keyboard-only via globals.css).
- [x] `prefers-reduced-motion` honored (animations/transitions reduced).
- [x] Command palette, Settings, sidebar are keyboard-operable (typed routes
      + central keymap; ⌘K palette with arrow-key nav).
- [ ] Manual VoiceOver pass on the primary surfaces (recommended before public alpha).

## Performance budgets

Targets for a personal-CRM-scale dataset (hundreds–low-thousands of records).
Measure on a developer workstation; treat as gates, re-measure on seed-large data.

| Metric | Budget |
| --- | --- |
| Cold app open | < 2 s |
| DB open + migration (warm) | < 200 ms |
| Command-palette query latency | < 50 ms (FTS over chunks) |
| Today daily-brief retrieval | < 150 ms |
| Graph render (seed-large) | < 500 ms |
| Resident memory (idle) | < 250 MB |

Notes: retrieval is FTS5 (indexed); the daily brief is a handful of indexed
queries; the graph caps nodes per kind. Embeddings are off by default and must
stay off the UI thread when added.

## Privacy / model-boundary review

- [x] Provider keys are keychain-only (desktop) / env-only (CLI); never in
      settings rows.
- [x] No hosted Local Brain service in the core path; SQLite is the only store.
- [x] External model calls are available when an AI provider key is configured;
      provider status is surfaced in Settings → AI providers and Diagnostics.
- [x] External payloads are minimal: only retrieved cited chunks, assembled
      through one checked helper.
- [x] Extracted memories and tasks persist `evidence_refs` that open the source.
- [x] CSP restricts `connect-src` to the known provider hosts.

## Signing / notarization checklist (deferred for alpha)

Unsigned local builds are supported for the alpha. Before public distribution:

- [ ] Apple Developer ID Application certificate; sign the `.app`.
- [ ] Hardened runtime enabled.
- [ ] Sign the embedded `brain` sidecar inside the bundle (and any future
      `sqlite-vec` / embedding-runtime dylibs).
- [ ] Notarize the `.app`/`.dmg`; staple the ticket.
- [ ] Verify Gatekeeper acceptance on a clean machine.

## Update path decision

- **Alpha: defer auto-update.** Distribute the `.app`/`.dmg` directly; users
  replace the app to update.
- **Post-alpha:** adopt the official Tauri updater plugin with GitHub
  Releases-hosted artifacts. Keep the updater signing key separate from the Apple
  signing key.
