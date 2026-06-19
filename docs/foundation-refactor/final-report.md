# Foundation Refactor — Final Report

## PR

- **PR:** #49 — https://github.com/maccman/local-brain/pull/49
- **Title:** Refactor Local Brain foundation: shared domain write layer
- **Base:** `master` @ `9cd2d84`
- **Branch:** `codex/local-brain-foundation-refactor`
- **Final commit SHA:** `0836b2d9009f623ec100ca395bdc89d51efdb4bb`
- **Diff:** 30 files changed, +854 / −161, across 4 commits.

## What this refactor is (and is not)

Local Brain had already been through one broad cleanup (`docs/large-refactor/`),
which correctly concluded the architecture was sound. So this pass deliberately
did **not** re-layer or churn. Three independent audits (Rust CLI, desktop
frontend, TS core) were run and converged on a single highest-leverage,
non-cosmetic gap:

> There was no shared validation/normalization layer at the record-write
> boundary, and the create/update/archive scaffolding was duplicated across six
> TypeScript domains and five Rust `add` commands. Records were stored exactly as
> handed in — untrimmed names, mixed-case emails, un-normalized domains, and even
> empty documents/interactions were accepted.

Because **agents write through two independent paths** (the desktop core and the
`brain` CLI), this directly degraded the duplicate detection in
`extraction/match.ts` (which keys on `normalizeEmail`/`normalizeDomain`/
`normalizeName`, none of which were applied on the way in). The architecture doc
already specified a per-domain `validators.ts`; it was never built. This refactor
builds it once and applies it consistently to both write paths.

## Major architecture changes

1. **A single write boundary in `packages/core`.**
   - `text/normalize.ts` — consolidated field normalizers (`normalizeName`,
     `normalizeEmail`, `normalizeDomain`, moved out of `extraction/match.ts`,
     which re-exports them) plus the missing storage primitives `squish` and
     `trimToNull`.
   - `validation.ts` — typed `ValidationError` (`kind: 'validation'`, added to the
     shared `AppErrorKind`) and `requireText`.
   - per-domain `validators.ts` for people, organizations, projects, tasks,
     documents, interactions: pure `validateNew*` / `validate*Patch` functions
     that normalize string fields and enforce the preconditions SQLite cannot.
2. **Shared record-mutation helpers.** `db/records.ts` now exports
   `insertRecord` / `updateRecord` / `archiveRecord`; the id-generation,
   `updated_at`, and `archived_at` plumbing is written once instead of six times.
   Every setter is `validate → helper`.
3. **CLI write parity.** The `brain` CLI applies the same storage normalization
   and the same title-or-body precondition (Rust twin of the core validators), and
   the `graph` command now uses a bound parameter instead of interpolating the
   self id into SQL.
4. **Docs realigned.** `architecture-conventions.md` corrected to the real
   `domains/<domain>` layout, with a new **Write Boundary** section.

## Intentional backwards-incompatible changes

Backwards compatibility was explicitly waived by the request.

- The six `create*`/`update*` core setters now **throw `ValidationError`** on a
  blank required field, and reject a document/interaction that has neither a title
  nor body, instead of writing a degenerate row.
- Stored values are **normalized**: names/titles squished, emails lowercased, org
  domains canonicalized, blank optional fields collapsed to `null`.
- `brain add document|interaction` exits `1` with a stderr diagnostic on an empty
  title+body (no stdout, no row written).
- `AppErrorKind` gains a `'validation'` member.

No existing test, seed, or UI path changed behavior — they only ever created
clean, titled records — so these are pure data-quality gains.

## Files / modules changed

- **Core (new):** `packages/core/src/text/normalize.ts` (+ test),
  `packages/core/src/validation.ts`, `domains/{people,organizations,projects,
  tasks,documents,interactions}/validators.ts` (+ tests for people, organizations,
  documents, interactions, tasks).
- **Core (changed):** `db/records.ts` (shared helpers), the six `*/setters.ts`,
  `extraction/match.ts` (re-export), `errors.ts` (`'validation'` kind), `index.ts`
  (public exports).
- **CLI:** `apps/cli/src/commands/add.rs`, `apps/cli/src/commands/graph.rs`,
  `apps/cli/tests/cli.rs`.
- **Docs:** `docs/plans/architecture-conventions.md`,
  `docs/foundation-refactor/{plan,status,final-report}.md`.

## Verification commands and exact results

Run from the repo root after the final commit. The sidecar is staged before the
Tauri crate, per the documented build order.

| Command | Result |
| --- | --- |
| `git diff --check` | ✅ clean (working tree and `9cd2d84..HEAD`) |
| `pnpm check` (typecheck + oxlint + vitest + schema drift) | ✅ exit 0 |
| `pnpm --filter @local-brain/desktop build` | ✅ vite build OK (pre-existing chunk-size + dynamic-import warnings only) |
| `pnpm --filter @local-brain/desktop sidecar` | ✅ staged `binaries/brain-aarch64-apple-darwin` |
| `cargo fmt --all -- --check` | ✅ exit 0 |
| `cargo check --workspace` | ✅ exit 0 |
| `cargo test --workspace` | ✅ exit 0 |

Test counts after the refactor:

- `@local-brain/core`: **184** tests (was 162; +22 normalize/validator units).
- `@local-brain/desktop`: **77** vitest + **51** Rust desktop-crate tests.
- `@local-brain/db`: **4** (incl. the schema-drift check).
- `brain-cli`: **18** integration tests (was 16; +2 empty-record rejections) +
  **2** skill tests.

## Caveats / follow-ups

- **Sidecar staging is a prerequisite for the Tauri crate.** A bare
  `cargo check --workspace` fails on a clean checkout until
  `pnpm --filter @local-brain/desktop sidecar` stages the gitignored
  `binaries/brain-<triple>`. Pre-existing and documented; not introduced here.
- **Bundled `.app` not launched.** Verification is the automated gate suite, the
  Vite build, the staged sidecar, and the full Rust workspace — not a manual run
  of the packaged app. The dom/unit/integration suites cover the changed paths.
- **The Rust CLI and TS core remain parallel implementations by design.** The
  TS-owns-policy / Rust-owns-native split is deliberate (documented in
  `architecture-conventions.md`); unifying it would require embedding a JS runtime
  in the CLI or rewriting core in Rust, which was intentionally left out of scope.
  This PR instead makes the *behavior* consistent and pins it with tests on both
  sides. A future option is to share one normalization contract via codegen.
- **Validators not yet extended to memories/chat**, and `checkers.ts` (FK
  existence checks) is still unbuilt — natural next increments on the same layer.
- **Desktop query-invalidation tuning** (a few mutation hooks call
  `invalidateQueries()` with no key filter) is real but behavioral and was left to
  its own focused PR.
