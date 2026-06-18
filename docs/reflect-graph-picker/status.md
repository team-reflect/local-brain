# Status — Reflect graph picker → Local Brain brain picker

Branch: `codex/local-brain-reflect-graph-picker` · base `58c801f`.

## Phase

Complete, plus Alex's follow-up correction applied. Pushed; PR #26 open against
master (https://github.com/maccman/local-brain/pull/26).

## Follow-up correction (2026-06-18)

Alex required two changes; both done:

1. **No JSON for durable state.** The Rust-owned `brains.json` registry was
   replaced with a dedicated SQLite database (`<app data dir>/registry.sqlite`):
   tables `brains` (catalogue) + `registry_meta` (active path). WAL-backed atomic
   upserts; a corrupt/non-SQLite file is moved aside (`.sqlite.corrupt`) and
   recreated. Runtime DB switching unchanged (real, via `DbState::swap`).
2. **Native dialog plugin installed.** Added `tauri-plugin-dialog` (Rust) +
   `@tauri-apps/plugin-dialog` (JS), `dialog:default` capability, and wired the
   brain create/open dialog to the native OS file picker (open) / save dialog
   (create) via `lib/native-dialog.ts`. The validated path field stays as an
   editable fallback. `reveal_brain` still uses the already-wired opener plugin.

Docs/comments/tests updated so no durable brain-picker state is described as JSON.
Re-ran the full verification suite (all green — see final-report.md).

## Cursor Bugbot review fixes (2026-06-18)

Two Bugbot findings on PR #26, both resolved against the SQLite-backed registry:

1. **High — switch succeeds when registry save fails.** `open_brain`/`create_brain`
   swapped the live `DbState` connection *before* persisting the active brain, so a
   failed registry write returned an error while the connection already pointed at
   the new brain (UI shows the old brain, reads/writes hit the new one). Fixed with
   a shared `switch_to` helper that persists the registry first and only swaps on
   success — a failed persist leaves both stores on the previous brain.
2. **Medium — registry memory updated before persist.** Structurally moot after the
   SQLite rewrite: the registry *is* a SQLite database read on demand, with no
   separate in-memory catalogue, so a failed metadata write leaves observable state
   unchanged. Documented the invariant and added a regression test that proves a
   rejected write (`PRAGMA query_only`) does not diverge from disk.

New regression tests (`brains.rs`): persist-fails-no-swap, success persists-then-swaps,
and failed-metadata-write-leaves-state-unchanged. `cargo test`/`clippy`/`fmt` green.

## Bugbot review fix (2026-06-18, head 7a72f41)

One new Bugbot finding on PR #26, resolved:

1. **Medium — stale workspace key after switch.** `useOpenBrain`/`useCreateBrain`
   only invalidated the query cache on success, so `App` kept `BrainWorkspace`
   keyed on the previous brain's path until `active_brain` refetched, while other
   invalidated queries could already return data from the newly active brain
   (brief mixed workspace state). Fixed with a `useApplyBrainSwitch` helper that
   seeds `active-brain` with the returned `BrainInfo` via `setQueryData` *before*
   invalidating everything else, so `App` re-keys the workspace immediately and
   the remount reads every invalidated query fresh under the new path.

New regression test (`lib/queries/brains.dom.test.tsx`): a switchable bridge proves
both open and create seed `active-brain` with the new brain synchronously, before
any invalidation refetch. `pnpm check` + desktop build green.

## Bugbot review fixes (2026-06-18, head 11c81ff)

Two Bugbot findings on commit `0370453`, both resolved:

1. **High — Stale cache after brain switch** (`apps/desktop/src/lib/queries/brains.ts`).
   After `openBrain`/`createBrain`, Rust repoints `DbState` at the new brain, but
   `onSuccess` only seeded `active-brain` and called `invalidateQueries()` —
   which marks queries stale yet keeps serving previous-brain cached rows until
   background refetches finish, so old-brain tasks/people (with ids that could
   collide with the new brain's) could render while reads/writes hit the new DB.
   `useApplyBrainSwitch` now seeds `active-brain`, then **removes every
   brain-scoped query** (`removeQueries` with a predicate that preserves only the
   brain-picker queries — the seeded `active-brain` and the cross-brain `brains`
   catalogue) so the remounted workspace has no stale cache to fall back on and
   fetches each surface fresh; the catalogue is then invalidated to refresh the
   active flag / order. New DOM test asserts brain-scoped caches (`tasks`,
   `people`) are removed on switch while the picker state is preserved.
2. **Medium — List marks wrong active brain** (`apps/desktop/src-tauri/src/brains.rs`).
   `list_brains`/`infos` set `isActive` (and attached `schemaVersion`) from the
   registry's recorded `active_path`, which can be stale if startup
   `register_active` failed (ignored with `let _ =` in `lib.rs`). `infos` now
   derives active-ness and the schema version from the **live `DbState` open
   path** (`list_brains` and `forget_brain` pass `db.active_path()`), so a stale
   registry pointer can never flag the wrong brain or attach a schema version to a
   brain that is not open. New Rust test
   `infos_derives_active_from_live_db_not_stale_registry` proves a registry
   pointing at A while the live DB is open on B flags only B active.

New tests: `brains.dom.test.tsx` (stale brain-scoped caches removed on switch),
`brains.rs::infos_derives_active_from_live_db_not_stale_registry`. Full suite
(`pnpm check`, desktop build, `cargo fmt`/`clippy`/`check`/`test`) green.

## Bugbot review fix (2026-06-18, head cec2308 · comment on 11c81ff)

One new Bugbot finding (comment `3437049057`) on commit `11c81ff`, resolved:

1. **Medium — Overlapping brain switches desync** (`apps/desktop/src-tauri/src/brains.rs`,
   `apps/desktop/src/components/brain-switcher.tsx`). `switch_to` persisted the new
   active brain to the registry and then swapped the live `DbState` under two
   *separate* locks with no single critical section. Overlapping `open_brain` /
   `create_brain` calls (rapid Switch clicks) could interleave — both persist, then
   swap in the opposite order — leaving `registry_meta` recording one brain while the
   live SQLite connection was open on another, so the next startup's
   `active_candidate` would reopen the wrong brain (no in-session desync now that
   `active_brain`/`list_brains` derive active-ness from the live connection, but the
   two stores still disagreed on disk until restart). Fixed by adding a dedicated
   **switch mutex** to `BrainState` that `switch_to` holds across *both* the registry
   persist and the live swap, making the pair one indivisible critical section with
   respect to other switches; the last switch to start wins both stores. The
   persist-before-swap invariant is preserved (a failed durable persist still returns
   without swapping). Ordinary reads/writes never take the switch lock. The switcher
   UI also ignores a new pick while `openBrain` is pending, avoiding a redundant
   second switch. New Rust test `overlapping_switches_keep_registry_and_live_db_in_sync`
   hammers 200 rounds of two simultaneous opposite-direction switches and asserts
   `registry_meta` and the live `DbState` always name the same brain.

`cargo fmt`/`clippy`/`check`/`test` (21 desktop-lib tests), `pnpm check` (48 desktop
tests), and the desktop build are all green.

## Bugbot review fixes (2026-06-18, head ad147c6 · comments on cec2308)

Two new Bugbot findings on commit `cec2308`, both resolved in `brains.rs`:

1. **High — Uncatalogued brain rename fails.** `rename_brain` / `set_brain_color`
   only ran `UPDATE brains … WHERE path = ?` and 404'd when no row matched. But the
   active brain can be valid yet *uncatalogued* — `active_info` synthesizes a record
   when startup `register_active` failed (ignored with `let _ =` in `lib.rs`) or for
   a `$BRAIN_DB` pin that was never persisted — so Settings offered rename/color for
   a brain the commands then reported "not found". Fixed with a shared `edit_metadata`
   helper: when the edit targets the *live* active brain (per `DbState::active_path`)
   it first materializes a default catalogue row via `ensure_catalogued`
   (`INSERT … ON CONFLICT DO NOTHING`, leaving any existing row/timestamps and the
   active pointer untouched), then applies the edit. Non-active uncatalogued paths
   are still rejected, and a persistence failure (read-only registry) surfaces before
   anything lands, so observable state is unchanged.
2. **Medium — Duplicate brain registry paths.** `mark_opened` keyed the catalogue on
   the exact path string passed in, so the same brain reached by different spellings
   (a stored candidate path vs the startup `canonicalize` of it, a `$BRAIN_DB` pin)
   could insert a second row and list the brain twice. `mark_opened` now `normalize`s
   the path into the catalogue key *and* the active pointer (canonicalize-or-fallback,
   matching the metadata commands), so every registry upsert/active write converges on
   the canonical key.

New Rust tests: `edit_materializes_uncatalogued_active_brain`,
`edit_rejects_unknown_non_active_path`, `edit_on_readonly_registry_creates_no_row`,
and `mark_opened_dedupes_path_spellings`. `cargo test -p local-brain-desktop`
(25 tests) and `cargo clippy` are green.

## Bugbot review fixes (2026-06-18, head afdc8d6)

Two new Bugbot findings on commit `afdc8d6`, both resolved in `brains.rs`:

1. **High — Registry file openable as brain.** `open_brain` accepted any existing
   `.sqlite` file after `canonicalize`, including the app's own `registry.sqlite`.
   Choosing it would run brain migrations on the registry DB, point `DbState` at it,
   and leave a second live connection to the same file for the catalogue. `BrainState`
   now records the registry's canonical `registry_path` at `load`, and `open_brain`
   (via the testable `open_brain_impl`) rejects any path that `is_registry` — a
   canonical comparison that re-canonicalizes the stored path so a recreated registry
   still matches. Ordinary brains still open unchanged.
2. **Medium — In-memory registry hides lost saves.** If `registry.sqlite` could not be
   recreated after corrupt recovery, `open_resilient` fell back to an in-memory
   registry and brain switches / catalogue edits then succeeded for the session but
   silently disappeared on the next launch. `open_resilient` now returns a `durable`
   flag (`false` only for that in-memory fallback), stored on `BrainState`. Every
   registry *write* — `register_active` (so any `switch_to`), `edit_metadata`
   (rename/color), and `forget_brain` — first calls `require_durable`, which fails
   loudly with a restart-the-app message instead of pretending the write stuck. Reads
   and startup still work, so resilience is kept without silent lost saves. The
   persist-before-swap ordering means a blocked switch leaves the live `DbState` on
   the previous brain.

New Rust tests: `open_brain_rejects_the_registry_file`, `open_brain_opens_a_real_brain`,
`non_durable_registry_blocks_switch_loudly`, `non_durable_registry_blocks_metadata_and_forget`,
and `durable_registry_still_allows_writes`; `corrupt_registry_falls_back_to_empty` now
also asserts the recreated registry stays durable.

## Bugbot review fixes (2026-06-18, head 8e18b20)

Two new Bugbot findings on commit `8e18b20`, both resolved in `brains.rs`:

1. **Medium — Registry update not atomic.** `mark_opened` ran the catalogue upsert
   and `registry_meta` active-path update as two autocommit writes. If the active
   metadata write failed after the upsert committed, the catalogue could record a
   brain as opened while `active_path` stayed stale, violating the documented
   persist-before-swap guarantee. `mark_opened` now wraps both writes in one SQLite
   transaction, so a failed active-path write rolls the catalogue upsert back too.
   New Rust test `mark_opened_rolls_back_catalogue_when_active_update_fails`.
2. **Low — Forget silently no-ops.** `forget_brain_impl` issued `DELETE FROM brains`
   but ignored the affected-row count. A stale path or legacy spelling could return
   success and an unchanged list, implying the brain was forgotten when no row was
   removed. The command now checks the delete count and returns `not_found` when no
   catalogue row matched, while preserving the active-brain and non-durable registry
   guards. New Rust tests `forget_unknown_path_errors_instead_of_silent_no_op` and
   `forget_removes_catalogued_non_active_brain`.

## Bugbot review fixes (2026-06-18, head a1330a2)

One new Bugbot finding on commit `a1330a2`, resolved in `brains.rs`:

1. **High — Registry openable at app startup.** `open_brain` refuses
   `registry.sqlite` as a brain via `is_registry`, but startup called
   `open_and_migrate` on whatever `active_candidate` returned with no equivalent
   check. A `$BRAIN_DB` pin or a stale stored active path pointing at
   `registry.sqlite` would migrate the catalogue like a brain and keep a second
   live connection to it. `active_candidate` now filters both the `$BRAIN_DB` pin
   and the stored active path through `is_registry`, falling through to the default
   brain (never the registry) when either points at it. `is_registry` also
   canonicalizes its candidate so a relative/symlinked spelling still resolves.
   New Rust test `active_candidate_skips_a_stale_registry_active_path`.

## Bugbot review fix (2026-06-18, head 40242c4 · comment `3437388117`)

One new Bugbot finding on PR #26's current head, resolved in `apps/desktop/src/App.tsx`:

1. **Medium — Query error shows chooser.** The App root gate rendered `BrainChooser`
   whenever `useActiveBrain()` was `isError`, even though TanStack Query keeps the last
   successful `active-brain` data on a background refetch failure. A transient
   IPC/validation error could therefore tear down the whole workspace and drop the user
   into the chooser while Rust still had a brain open. The gate now keys solely on the
   data — `if (!active.data) return <BrainChooser />` — so a refetch error with data
   still present keeps the workspace mounted; the chooser only shows when the initial
   resolution produced no active brain. (`active_brain` always returns a `BrainInfo` or
   errors, so "has data" is the right signal for "a brain is open".)

New regression test (`apps/desktop/src/App.dom.test.tsx`): drives `useActiveBrain`'s
result directly — the gate-distinguishing case is `isError: true` *with* data retained,
which the QueryObserver surfaces on refetch failure — and asserts the workspace stays
mounted on error-with-data, the chooser shows only on error-with-no-data, and the
pending/healthy cases behave. Verified the test fails against the old gate and passes
against the fix. `pnpm check` + desktop build green. No Rust changed (cargo gates
skipped).

## Follow-up: first-run once per install, not per brain (2026-06-18)

One further Bugbot finding on PR #26's current head (58f0ebe), resolved in
`apps/desktop/src/lib/queries/settings.ts`:

1. **Medium — First-run repeats per brain.** Onboarding completion was stored as a
   `firstRun.completed` row in the active brain's SQLite `settings` table. But
   switching or creating a brain remounts the workspace keyed by path against a
   *different* DB, so a new/other brain had no completed row and the welcome modal
   reappeared after the user had already dismissed it — contrary to once-per-install
   behavior. `useFirstRun`/`useCompleteFirstRun` now read/write the flag from
   `localStorage`, which is scoped to the desktop webview origin (the install/profile)
   and shared across every brain DB. Reads/writes are wrapped so a locked-down or
   unavailable store fails safe (onboarding simply reappears) rather than throwing.
   `getSetting`/`setSetting` are no longer imported here.

New/adjusted regression tests (`apps/desktop/src/components/first-run.dom.test.tsx`):
back `localStorage` with an in-memory stub (jsdom's opaque origin has none), and assert
(a) a fresh install shows the welcome, (b) an install-scoped completed flag keeps it
hidden, and (c) dismissing it on one brain keeps it hidden after remounting against a
different brain's DB. `pnpm check` + desktop build green. No Rust changed (cargo gates
skipped).

## Follow-up: registry must not advance when live DB swap cannot run (2026-06-18)

One further Bugbot finding on PR #26's current head (bd706c0), resolved in
`apps/desktop/src-tauri/src/db/mod.rs` and `apps/desktop/src-tauri/src/brains.rs`:

1. **Medium — Registry advances when swap fails.** `switch_to` persisted the new active
   brain to the registry before calling `DbState::swap`. If the live DB lock was
   poisoned, the command failed after `registry_meta` had advanced, so the current
   session stayed on the old brain while the next launch could reopen the new one.
   `DbState` now exposes `swap_after`, which acquires the live DB lock first, runs the
   registry commit while that lock is held, and only then swaps the connection/path.
   This preserves the earlier persist-before-swap guarantee for registry failures while
   also preventing registry advancement when the live DB lock itself is unavailable.

New regression test (`brains::tests::switch_does_not_advance_registry_when_live_db_lock_fails`):
poisons the live DB lock before switching and asserts the registry records no active path
or target-brain row. Rust-focused verification green; full PR gates were rerun before
pushing this follow-up.

## Progress

- [x] Read AGENTS.md, docs, supervisor skill; mapped Local Brain + both Reflect refs.
- [x] Terminology decision: **Brain** (container) vs **Graph** (network viz).
- [x] plan.md written.
- [x] Rust: brain registry + commands + DbState swap (+ tests).
- [x] Core: brains domain (schemas + IPC bindings) (+ test).
- [x] Desktop: brain-colors, BrainSwatch, query hooks.
- [x] Desktop: brain switcher + dialog + chooser.
- [x] Desktop: app-shell + App gating/remount + `go.brain` command.
- [x] Desktop: Settings → Brain section + Local database/Diagnostics updates.
- [x] Terminology audit across docs (architecture-conventions, ui-direction,
      design-system, launch/README).
- [x] Tests: Rust (registry + swap), core (IPC bindings), DOM (switcher, settings).
- [x] Verification suite (all green — see final-report.md).
- [x] final-report.md + PR.

## Blockers

None.
