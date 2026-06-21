# Import Improvements — final report

All four workstreams from [plan.md](plan.md) are implemented, tested, and
live-validated against the real brain at `~/Documents/local-brain2`. Branch:
`claude/dazzling-bardeen-4e90be`. See [status.md](status.md) for the checklist.

## What shipped

### 1. Self-identity (`brain self`)
- `brain self show` / `brain self set --full-name --email… --phone… --headline --location`.
- Registered handles let import-time participant resolution auto-link the user — no
  `--self-participant` needed once an address is on the self person.
- Files: `apps/cli/src/commands/add/person.rs`, `main.rs`. No migration.

### 2. Organizations, affiliations, richer people
- New CLI writers the import path previously lacked entirely: `brain add organization`
  (dedupe by name → email domain) and `brain affiliate --person --org [--title --role
  --current]`.
- `brain add person` and `brain add person-from-email` gained `--org`/`--org-domain`/
  `--title`/`--current` (and `--headline`/`--phone`/`--location` for the email path), so
  a signature's structured fields are captured instead of discarded. `--current` keeps a
  single current employer and stamps `people.current_organization_id`.
- Files: `organization.rs`, `affiliation.rs` (new), `person.rs`, `main.rs`. No migration.

### 3. Suggestions surface (migration 0011 + guardrail revision)
- `suggestions` + `suggestion_links` tables (schema v11). A user-facing curation queue
  for structure the importer must not auto-create (new project / organization).
- `brain suggest project|organization|list|accept|dismiss`. Accept performs the typed
  write and relinks the cited records in one transaction; proposals dedupe by (kind,
  normalized title) across every status, so dismissals are durable and never re-raised.
- Revised the `AGENTS.md` "no automation log surface" guardrail to permit this narrowly
  (actionable + cites evidence, not an activity log); documented in `launch-schema.md`.
- Files: migration `0011_suggestions.sql`, `brain-schema/src/lib.rs`, `suggestion.rs`
  (new), `project.rs`/`organization.rs`/`affiliation.rs` (exposed helpers), `main.rs`,
  `AGENTS.md`, `docs/launch-schema.md`, regenerated `packages/db/src/schema.gen.ts`.

### 4. Thread freshness + evidence-by-quote
- A source-backed re-import whose body diverged returns `bodyChanged: true`; `--refresh`
  re-digests only when changed (a safe no-op otherwise) so daily automation can pass it
  freely.
- `--evidence interaction:<id>~"quote"` resolves the chunk containing the quote at write
  time, removing the write→inspect→cite round-trip. `#index` still works.
- Files: `interaction.rs`, `commands/mod.rs` (`EvidenceLocator`), `links.rs`. No migration.

## Verification
- Rust: `brain-schema` (17) and `brain-cli` (46 unit / 54 integration / 2 skill) green;
  `local-brain-desktop` compiles against schema v11.
- TS: `pnpm typecheck` 4/4; `check-drift` clean (schema.gen.ts regenerated); `pnpm lint`
  clean apart from one pre-existing unrelated `core/src/index.ts` warning.
- Skill lint (`apps/cli/tests/skill.rs`) covers every new command.
- Live: self addresses registered + auto-resolve; Evensen Design org + Lisa/Erica
  affiliations; "West Elizabeth" proposed → accepted → project created + records
  relinked; evidence quote resolved to the sink chunk; `bodyChanged` detected without
  mutating; `--refresh` no-op confirmed.

## Follow-ups (not done)
- Desktop UI surfaces for suggestions, orgs/affiliations, and self-identity (the CLI/
  conversation is the review path for now).
- `merge_people` and richer suggestion kinds (deferred deliberately to keep the queue
  from becoming a junk drawer).
- Email-body extraction guidance for agents (the Philip Joubert HTML-only case) remains
  the importer's responsibility; could be a skill recipe later.
