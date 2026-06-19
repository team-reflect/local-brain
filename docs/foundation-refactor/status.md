# Foundation Refactor — Status

Branch: `codex/local-brain-foundation-refactor` · base `origin/master` @ `9cd2d84`.

## Commits

1. `refactor(core): add shared domain write layer (validation + normalization)`
   - `text/normalize.ts` (consolidated normalizers + `squish`/`trimToNull`),
     `validation.ts` (`ValidationError` + `requireText`), `'validation'` added to
     `AppErrorKind`.
   - per-domain `validators.ts` for people, organizations, projects, tasks,
     documents, interactions.
   - `db/records.ts` shared `insertRecord`/`updateRecord`/`archiveRecord`.
   - six setters rewired to `validate → helper`.
   - tests: core 162 → 184 (+22).

2. `refactor(cli): align write validation with core + parameterize graph query`
   - `add document` / `add interaction` normalize title and reject empty
     title+body; document `kind` trimmed.
   - `graph` self-exclusion parameterized.
   - tests: CLI 16 → 18 (+2).

3. `docs(foundation-refactor): align conventions with the implemented write layer`
   - architecture-conventions.md: `domains/` layout + Write Boundary section.
   - reports under `docs/foundation-refactor/`.

## Follow-up — Cursor Bugbot fixes (PR #49)

Three current-head Bugbot findings, fixed without broadening the refactor:

1. `3439812121` / BUGBOT `ed6682f5-34f0-4f31-8e38-11c6568e4bc8` — *Patch clears
   required title or body.* Added `assertTitleOrBody` to `db/records.ts`;
   `updateDocument`/`updateInteraction` now read the existing row and reject a
   patch that would leave a record with neither title nor body. The read is
   skipped when the patch is provably safe (supplies a non-null title/body, or
   touches neither field).
2. `3439812126` / BUGBOT `cf909b13-9108-41f6-9a57-c6b37ad5dda3` — *CLI title trim
   not squish.* Added `squish`/`normalize_title` to `apps/cli/src/commands/add.rs`;
   `add document`/`add interaction` titles now collapse internal whitespace like
   core `squish`, not just trim the ends.
3. `3439818587` / BUGBOT `40bc1e31-511e-425b-bc1a-397a894a056a` — *Ingest bypasses
   document validation.* `ingestDocument` (and `ingestInteraction`, for parity)
   now route through `validateNewDocument`/`validateNewInteraction`, so a
   whitespace-only paste/import can no longer create a titleless/bodyless record.

Tests: +6 core integration (`db/integration.test.mjs`), +2 CLI
(`apps/cli/tests/cli.rs`). Core 190 / CLI 20.

## Verification

All gates green — see `final-report.md` for the exact commands and results.

## Blockers

None.
