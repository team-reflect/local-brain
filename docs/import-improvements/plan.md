# Import Improvements

Decision-oriented plan from a real Gmail import trial (`~/Documents/local-brain2`,
Jun 2026). Four workstreams, each PR-sized. Ordered so later steps build on earlier
ones. "No sacred cows": this revises one `AGENTS.md` guardrail (Step 3).

## Motivating friction (observed, not hypothetical)

1. **No self-identity.** The `is_self` person had no email; the user has several
   (`alex@maccaw.org`, `maccman@gmail.com`). Every interaction needed an explicit
   `--self-participant`; a missed one would import the user as a stranger. Participant
   resolution already matches `person_emails`, so registering the user's addresses on
   the self row would auto-resolve self for free.
2. **Lossy, employer-blind person capture.** `person-from-email` takes only
   name+email, discarding signature gold (title, phone, org, address). And the CLI has
   **no `add organization` / affiliation writer at all**, so imports cannot record
   employers even when two correspondents clearly share a company domain
   (`@evensendesign.com`). The schema (`organizations`, `affiliations`,
   `current_organization_id`) is built for this and went unused.
3. **Suggestions evaporate.** Rules (correctly) forbid auto-creating projects/orgs and
   say to "surface as a suggestion" — but there is no durable home for a suggestion, so
   it only lived in chat prose and was lost. `AGENTS.md` forbids an automation-log
   surface; a user-facing *curation queue* is a different thing and should be allowed.
4. **Thread staleness + clunky evidence.** A re-imported thread only fills blank fields
   and silently keeps the stale digest unless `--replace-body` is passed; dedupe output
   doesn't signal that the body changed. And grounding a memory/task in a chunk required
   a write→query-`content_chunks`→cite-`#index` round-trip the agent can't predict.

---

## Step 1 — Self-identity (`brain self`)

**Goal:** the importer auto-resolves the user as a participant without `--self-participant`.

- **CLI:** add `brain self show` and `brain self set --full-name --preferred-name
  --email… --phone… --headline --location`. Ensures exactly one `is_self=1` person
  (create if absent, update if present), and adds `person_emails` / `person_phones`
  handles via the existing `insert_person_handles`.
- **Resolution:** no change needed — `find_person_by_email` already resolves any
  participant email (including self's) once self has handles. `--self-participant`
  remains a fallback for addresses not yet registered.
- **Skill:** add a "Step 0: identify yourself" setup note; explain that once self
  addresses are registered, `from:<your address>` auto-links to you.
- **Tests (Rust):** `self set` creates/updates the single self row + handles; a later
  `add interaction --participant "from:You <registered@addr>"` resolves to self.
- No migration.

## Step 2 — Organizations, affiliations, richer people

**Goal:** imports can record employers and carry structured contact fields.

- **CLI:** `brain add organization --name [--domain --kind --location --summary
  --source --external-id --original-url]`, find-or-create by normalized name then
  domain, with `external_identities` dedupe like people/interactions.
- **CLI:** affiliation capture. `brain add person … --org "<name>" [--org-domain <d>]
  [--title <t>] [--current]` find-or-creates the org and writes an `affiliations` row
  (+ sets `current_organization_id` when `--current`). Plus a standalone
  `brain affiliate --person <id> --org <id> [--title --role --current]`.
- **CLI:** `person-from-email` gains optional `--headline --phone --location --title
  --org`, applied on create and fill-blank on duplicate (route its enrichment through
  the same fill-blank logic `add person` uses).
- **Skill:** for a clearly-human correspondent, capture signature fields and the org;
  note that ≥2 correspondents sharing a domain is a strong org signal (create the org,
  or — once Step 3 lands — suggest it).
- **Tests (Rust):** org find-or-create + dedupe; person→org affiliation;
  person-from-email optional fields on create vs fill-blank on dup.
- No migration (tables exist).

## Step 3 — Suggestions surface (revises an `AGENTS.md` guardrail)

**Goal:** a durable, user-facing home for things the importer must not auto-create.

- **Migration 0011:** `suggestions` (id, kind `project|organization|affiliation|merge`,
  title, payload_json, rationale, status `open|accepted|dismissed`, created_at,
  resolved_at) + `suggestion_links` (suggestion_id, record_type, record_id, role) so a
  suggestion can cite the interactions/people it came from. Derived/idempotent: a
  suggestion is durable user-curation input, not an automation log.
- **CLI:** `brain suggest project|organization --title … --rationale … [--link
  interaction:<id>…]`; `brain suggestions list [--status open]`; `brain suggestion
  accept <id>` (project → create project + link its cited interactions/tasks) and
  `brain suggestion dismiss <id>`. Dedupe open suggestions by (kind, normalized title).
- **`AGENTS.md`:** revise the guardrail "Do not add a separate automation log surface"
  to explicitly permit a user-facing suggestion/curation queue, distinct from an
  automation log. Update `docs/launch-schema.md` and the schema diagram.
- **Skill:** replace "surface in prose" with `brain suggest …`.
- **Tests (Rust):** migration test; suggest→list→accept creates+links; dedupe.

## Step 4 — Thread freshness + evidence-by-quote

**Goal:** keep evolving threads fresh and make citations ergonomic.

- **CLI (freshness):** on a source-backed interaction dedupe, compare the incoming body
  hash to the stored `content_hash`; when they differ, include `bodyChanged: true` in
  the JSON (even without `--replace-body`) so daily automation knows to re-digest. Add
  `--refresh` to imply `--replace-body` when the body changed.
- **CLI (evidence):** accept `--evidence interaction:<id>~"<quote>"` (and the document
  form), resolving to the `content_chunks` row whose text contains the quote
  (case-insensitive) instead of requiring a known `#index`. Keep `#index` working.
- **Skill:** codify "re-import a grown thread with `--replace-body`/`--refresh`"; show
  evidence-by-quote.
- **Tests (Rust):** dedupe reports `bodyChanged`; `--refresh` re-chunks; evidence quote
  resolves to the right chunk; an ambiguous or missing quote errors clearly.
- No migration.

---

## Sequencing & risk

1 → 2 → 3 → 4. Step 1 is lowest-risk (no schema) and sets the CLI subcommand pattern.
Step 2 is additive. Step 3 is the only migration and the only guardrail change — review
the table shape and the `AGENTS.md` edit before merging. Step 4 is additive CLI polish.
Each step: focused `cargo test -p brain-cli`, update `skills/brain/SKILL.md`, and keep
`skills/brain` lint (`apps/cli/tests/skill.rs`) green.
