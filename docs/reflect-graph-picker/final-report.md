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

### Follow-up Bugbot findings (head `11c81ff` → this commit)

- **High — Stale cache after brain switch.** `useApplyBrainSwitch`
  (`apps/desktop/src/lib/queries/brains.ts`) seeded `active-brain` and then called
  `invalidateQueries()`, but invalidation only marks queries stale and keeps
  serving the previous brain's cached rows until background refetches finish —
  while Rust has already repointed the connection at the new brain. The UI could
  therefore render old-brain tasks/people (ids that may collide with the new
  brain's) against the new database. Fixed by seeding `active-brain`, then
  **removing every brain-scoped query** (`removeQueries` with a predicate that
  preserves only the brain-picker queries: the just-seeded `active-brain` and the
  cross-brain `brains` catalogue) so the remounted workspace has no stale cache and
  fetches each surface fresh; the catalogue is then invalidated to refresh its
  active flag / order. New DOM test in `brains.dom.test.tsx` asserts brain-scoped
  caches (`tasks`, `people`) are removed on switch while picker state survives.
- **Medium — List marks wrong active brain.** `list_brains` / `infos`
  (`apps/desktop/src-tauri/src/brains.rs`) derived `isActive` and `schemaVersion`
  from the registry's recorded `active_path`, which can be stale (e.g. a startup
  `register_active` ignored with `let _ =` in `lib.rs`, or otherwise stale
  metadata), so the list could flag the wrong brain active and attach a schema
  version to a brain that is not open. `infos` now takes the **live `DbState` open
  path** and derives active-ness and the schema version from it (`list_brains` and
  `forget_brain` pass `db.active_path()`; `forget_brain` also uses the live path
  for its can't-forget-the-active-brain guard). New Rust test
  `infos_derives_active_from_live_db_not_stale_registry` proves that with the
  registry pointing at A while the live DB is open on B, only B is flagged active
  (with the schema version) — never A. `cargo fmt`/`clippy`/`check`/`test`,
  `pnpm check`, and the desktop build are all green (20 desktop-lib Rust tests,
  48 desktop tests).

### Follow-up Bugbot finding (comment on head `11c81ff`)

- **Medium — Overlapping brain switches desync.** `switch_to`
  (`apps/desktop/src-tauri/src/brains.rs`) persisted the new active brain to the
  registry (`register_active`) and then swapped the live `DbState` connection
  (`db.swap`) under two *separate* locks, with no single critical section spanning
  both. Overlapping `open_brain` / `create_brain` calls (rapid Switch clicks) could
  interleave — both threads persist, then swap in the opposite order — settling with
  `registry_meta` recording one brain while the live SQLite connection was open on
  another. (In-session, `active_brain`/`list_brains` already derive active-ness from
  the live connection, so the UI wouldn't mislabel; but the registry's recorded
  active path and the live connection still disagreed on disk, so the next startup's
  `active_candidate` would reopen the wrong brain.) Fixed by adding a dedicated
  **switch mutex** to `BrainState`; `switch_to` now holds it across *both* the
  registry persist and the live swap, making that pair one indivisible critical
  section with respect to other switches, so the last switch to start wins both
  stores and they can never diverge. The persist-before-swap invariant is preserved
  (a failed durable registry persist still returns the error without swapping the
  live connection); ordinary reads and writes never take the switch lock, so query
  throughput is unaffected. `brain-switcher.tsx` additionally ignores a new pick
  while `openBrain` is pending, so a rapid double-click can't fire a redundant second
  switch that would needlessly churn the cache. New Rust test
  `overlapping_switches_keep_registry_and_live_db_in_sync` hammers 200 rounds of two
  simultaneous opposite-direction switches and asserts `registry_meta` and the live
  `DbState` always name the same brain. `cargo fmt`/`clippy`/`check`/`test` (21
  desktop-lib Rust tests), `pnpm check` (48 desktop tests), and the desktop build are
  all green.

### Follow-up Bugbot findings (comments on head `cec2308`)

- **High — Uncatalogued brain rename fails.** `rename_brain` / `set_brain_color`
  (`apps/desktop/src-tauri/src/brains.rs`) only ran `UPDATE brains … WHERE path = ?`
  and returned "not found" when no row matched. But the active brain can be valid yet
  *uncatalogued*: `active_info` synthesizes a record when startup `register_active`
  failed (ignored with `let _ =` in `lib.rs`) or for a `$BRAIN_DB` pin that was never
  persisted. So Settings happily offered rename/color for the open brain while those
  commands rejected it. Fixed by routing both commands through a shared
  `edit_metadata` helper: when the edit targets the *live* active brain (compared via
  `DbState::active_path`, both sides `normalize`d) it first materializes a default
  catalogue row with `ensure_catalogued` (`INSERT … ON CONFLICT DO NOTHING` — an
  existing row's name/color/timestamps and the active pointer are left untouched),
  then applies the edit. Any *non-active* uncatalogued path is still rejected, and a
  persistence failure (read-only registry) surfaces before the edit lands, so the
  observable state stays exactly as it was. New Rust tests
  `edit_materializes_uncatalogued_active_brain`, `edit_rejects_unknown_non_active_path`,
  and `edit_on_readonly_registry_creates_no_row`.
- **Medium — Duplicate brain registry paths.** `mark_opened` keyed the catalogue
  upsert (and the active pointer) on the exact path string handed in, so the same
  brain reached by two spellings — a stored candidate path vs the startup
  `canonicalize` of it, a `$BRAIN_DB` pin vs its canonical form — could insert a
  second row and list the brain twice. `mark_opened` now `normalize`s the path
  (canonicalize-or-fallback, the same helper the metadata commands already used) into
  both the catalogue key and the recorded `active_path`, so every registry upsert and
  active write converges on the canonical key and a brain can't appear twice. New Rust
  test `mark_opened_dedupes_path_spellings`. `cargo test -p local-brain-desktop`
  (25 tests) and `cargo clippy` are green.

### Follow-up Bugbot findings (comments on head `afdc8d6`)

- **High — Registry file openable as brain.** `open_brain`
  (`apps/desktop/src-tauri/src/brains.rs`) accepted any existing `.sqlite` file once
  `canonicalize` succeeded, including the app's own `registry.sqlite`. Picking the
  registry would run *brain* migrations on the registry DB, point `DbState` at it, and
  leave a second live connection to the same file for the catalogue — two writers, one
  file, schema confusion. Fixed by tracking the registry's canonical path on
  `BrainState` (recorded at `load`, after `open_resilient` has created the file) and
  rejecting any open whose canonical path `is_registry`. `is_registry` compares against
  the stored canonical path and re-canonicalizes it per call, so a recreated registry
  still matches and non-canonical spellings of the registry path are caught too.
  `open_brain` now delegates to a testable `open_brain_impl`. New Rust tests
  `open_brain_rejects_the_registry_file` (incl. a dotted spelling, asserting the live
  DB is untouched and nothing is catalogued) and `open_brain_opens_a_real_brain`.
- **Medium — In-memory registry hides lost saves.** When `registry.sqlite` could not
  be recreated after corrupt recovery, `open_resilient` fell back to an in-memory
  registry. Brain switches and catalogue edits then *appeared* to succeed for the
  session but silently vanished on the next launch — a non-durable store presented as
  durable. Fixed by making `open_resilient` return a `durable` flag (`false` only for
  that in-memory fallback) stored on `BrainState`, and gating every registry write
  behind `require_durable`: `register_active` (so any `switch_to`), `edit_metadata`
  (rename/color), and `forget_brain` now fail loudly with a "restart after restoring
  app-data access" message rather than reporting a write that won't survive a restart.
  Reads, listing, and startup still work on the fallback, so launch resilience is
  preserved without silent lost saves; because the switch persists before it swaps, a
  blocked switch leaves the live `DbState` on the previous brain. New Rust tests
  `non_durable_registry_blocks_switch_loudly`,
  `non_durable_registry_blocks_metadata_and_forget`, and
  `durable_registry_still_allows_writes`; `corrupt_registry_falls_back_to_empty` now
  also asserts the recreated registry stays durable. `cargo test -p local-brain-desktop`
  (30 tests) and `cargo clippy` are green.

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
