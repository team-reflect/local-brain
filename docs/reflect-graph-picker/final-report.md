# Final report — Reflect graph picker → Local Brain brain picker

Ported Reflect Next / Reflect Open's top-level **graph** picker/switcher into
Local Brain, renamed to **Brain** so the word "Graph" stays reserved for the
Network visualization.

## What shipped

### Terminology (the central product call)

- Top-level container = **Brain** (one local SQLite database). Reflect's "graph".
- **Graph** is unchanged: the Network surface's user-centered visualization.
- Disambiguation documented in `docs/plans/architecture-conventions.md`
  (Product Nouns), `docs/ui-direction.md`, `docs/design-system.md`, and
  `docs/launch/README.md`.

### Durable multi-brain model (real, not fake)

- **Brain registry** — a Rust-owned, dedicated **SQLite database** at
  `<app data dir>/registry.sqlite` (`apps/desktop/src-tauri/src/brains.rs`),
  deliberately separate from every switchable brain DB. Table `brains` holds each
  brain's `path`, `name`, `color`, `created_ms`, `last_opened_ms`; `registry_meta`
  holds the active path. WAL-backed atomic upserts, canonical paths, resilient
  load (a corrupt/non-SQLite file is moved aside to `registry.sqlite.corrupt` and
  recreated empty). This keeps Local Brain SQLite-first/local-first for durable
  product state — no JSON settings file (replaced the original `brains.json` per
  Alex's follow-up).
- **Runtime switching** — `DbState` now bundles the connection with its active
  path and can `swap()` it in place (`apps/desktop/src-tauri/src/db/mod.rs`). A
  failed open leaves the current brain intact. Startup precedence: `$BRAIN_DB`
  (CLI parity / explicit pin) → last active brain (if its file exists) → default.
- **Commands**: `list_brains`, `active_brain`, `open_brain`, `create_brain`,
  `rename_brain`, `set_brain_color`, `forget_brain`, `reveal_brain`.
  `database_path` now reports the live active brain. `brain-schema` gained
  `app_data_dir()`.

### Core (`packages/core/src/domains/brains/`)

- `brainColorSchema` (9-color enum, lenient `.catch` to default), `brainInfoSchema`.
- Typed IPC bindings for every brain command; exported from the core index.

### Desktop UI

- **BrainSwitcher** (`components/brain-switcher.tsx`) in the sidebar brand slot:
  active brain swatch + name, opening a keyboard-navigable menu (arrow keys,
  Escape, click-outside) to switch brain, create/open another, reveal the file,
  or open brain settings.
- **BrainSwatch** + `lib/brain-colors.ts` (indigo = app accent; 8 fixed colors).
- **BrainDialog** — native OS file dialog for create/open
  (`@tauri-apps/plugin-dialog`, wrapped in `lib/native-dialog.ts`: file-open for
  open, save dialog for create), with the validated path field kept as an
  editable fallback.
- **BrainChooser** — no-active-brain fallback screen.
- **App gating** (`App.tsx`): resolves the active brain and remounts the shell
  keyed by its path; switch hooks invalidate the whole query cache so every
  surface refetches against the new brain.
- **Settings → Brain** section: identity (name rename, color picker, location +
  reveal, schema version, created/last-opened), the list of other brains
  (switch/forget), and create/open. Local database + Diagnostics now report the
  active brain. New `go.brain` command (`Mod-Shift-B`).

### Tests

- Rust: SQLite-registry round-trip/persistence (reopens `registry.sqlite` from
  disk), rename/color, forget-keeps-active, corrupt-fallback (non-SQLite file →
  moved aside + empty registry), active-candidate precedence, and a
  `DbState::swap` test that proves queries hit the new brain. Plus the Bugbot
  regression tests below (`cargo test` — 19 desktop-lib tests).
- Core: brain IPC binding arg/shape tests + lenient color parse.
- Desktop DOM: `BrainSwitcher` (shows active brain, switches, opens new-brain
  dialog), `Settings → Brain` (identity, color picker, other-brains list), and
  `BrainDialog` native picker (mocks `lib/native-dialog`: "Browse…" fills the path
  from the save dialog and creates; open mode uses the open dialog). The shared
  fake bridge gained a non-db command responder.

## Verification (all green — re-run after the follow-up correction)

| Check | Result |
| --- | --- |
| `git diff --check` | clean |
| `pnpm check` (typecheck + lint + test) | pass — 45 desktop tests / 15 files (incl. new `brain-dialog.dom.test`), core + db green |
| `pnpm --filter @local-brain/desktop build` | pass (built `dist/`) |
| `pnpm --filter @local-brain/desktop sidecar` | built (required before Rust checks) |
| `cargo fmt --all -- --check` | clean |
| `cargo check --workspace` | pass (now also compiles `tauri-plugin-dialog`) |
| `cargo test --workspace` | pass (16 desktop-lib + 9 schema + 17 CLI tests) |

## Follow-up correction (2026-06-18)

Two changes Alex required after the first pass; both shipped:

- **No JSON for durable state.** Replaced the `brains.json` registry with a
  dedicated SQLite database (`registry.sqlite`), keeping Local Brain
  SQLite-first/local-first. Same commands, same real runtime switching.
- **Native dialog plugin installed and wired.** `tauri-plugin-dialog` (Rust) +
  `@tauri-apps/plugin-dialog` (JS) + `dialog:default` capability; the brain
  create/open dialog now uses the native OS picker (`lib/native-dialog.ts`).

## Cursor Bugbot review fixes (2026-06-18)

Two Bugbot findings on PR #26, both fixed in `apps/desktop/src-tauri/src/brains.rs`:

- **High — switch succeeds when registry save fails.** `open_brain`/`create_brain`
  called `DbState::swap` (the live connection) *before* `register_active` (the
  durable registry), so if the registry write failed the command returned an error
  while the SQLite connection already pointed at the new brain — the UI kept
  showing the previous brain while reads and writes hit the newly opened database.
  Fixed by extracting a `switch_to` helper that **persists the active brain first
  and only swaps the live connection on success**; a failed persist returns the
  error without swapping, so the open connection and the recorded active brain both
  stay on the previous brain. (`swap` itself only fails on a poisoned lock, i.e. an
  already-crashed thread.)
- **Medium — registry memory updated before persist.** Structurally resolved by the
  SQLite rewrite: the registry *is* a SQLite database read on demand, with no
  separate in-memory catalogue, so a metadata write that fails leaves the observable
  state exactly as it was (memory cannot diverge from disk). Documented the invariant
  in the module/​function docs and added a regression test.

Regression tests added: `switch_does_not_swap_live_db_when_registry_persist_fails`
(persist failure leaves the live DB on the old brain — would fail under the old
swap-then-persist ordering), `switch_persists_then_swaps_on_success`, and
`failed_metadata_write_leaves_registry_state_unchanged` (a write rejected via
`PRAGMA query_only` does not change read-back state). `cargo test`/`clippy`/`fmt`
green.

### Follow-up Bugbot finding (head `7a72f41`)

- **Medium — stale workspace key after switch.** `useOpenBrain`/`useCreateBrain`
  (`apps/desktop/src/lib/queries/brains.ts`) only called `invalidateQueries()` on
  success and never seeded `active-brain` with the returned `BrainInfo`. `App`
  keys `<BrainWorkspace>` on `active_brain.data.path`, so it stayed mounted under
  the *previous* brain's path until `active_brain` refetched — meanwhile other
  invalidated queries could already resolve against the newly active brain,
  producing a brief mixed-brain workspace. Fixed by a `useApplyBrainSwitch` helper
  that `setQueryData(ACTIVE_BRAIN_KEY, brain)` **before** invalidating the rest of
  the cache: `App` re-keys the workspace to the new path immediately and the
  remounted tree reads every invalidated query fresh. Metadata-only edits (rename,
  color) are unchanged. Regression test `apps/desktop/src/lib/queries/brains.dom.test.tsx`
  drives a switchable bridge and asserts both open and create leave `active-brain`
  holding the new brain synchronously, before any refetch (the assertion fails
  under the old invalidate-only behaviour).

## Caveats / deferred (honest scope)

- **Path field as fallback.** The native OS dialog is the primary affordance; the
  validated path field remains editable so manual entry still works (and shows the
  chosen path). Both routes are validated by Rust.
- **`reveal_brain`** uses the already-installed opener plugin from Rust
  (best-effort), isolated so it can be dropped if the API differs across platforms.
- **CLI is still single-brain** (`$BRAIN_DB`/default). Teaching the CLI to target
  a registry brain is a documented follow-up; the desktop registry is the
  multi-brain source of truth for now.
- **Demo seeding** runs per brain (existing `useEnsureSeed`), so a brand-new empty
  brain gets the same first-run demo data the default brain does.
- Could not launch the full Tauri app in this environment; verification relied on
  the build, vitest jsdom DOM tests, and the Rust test suite (incl. a real
  connection-swap test) rather than a manual click-through.

## Repo state

- Branch `codex/local-brain-reflect-graph-picker`, base `58c801f`.
- Commits: docs/plan → Rust registry+swap → desktop+core UI → docs terminology →
  this report.
- PR: **#26** — https://github.com/maccman/local-brain/pull/26 (base `master`).
