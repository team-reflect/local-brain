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

## Verification

All gates green — see `final-report.md` for the exact commands and results.

## Blockers

None.
