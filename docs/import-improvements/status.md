# Import Improvements — status

Branch: `claude/dazzling-bardeen-4e90be`. See [plan.md](plan.md).

## Step 1 — Self-identity — DONE
- `brain self show` / `brain self set` ([person.rs], [main.rs]); auto-resolves self via
  registered `person_emails`. Skill + contract + skill-lint updated. Tests green.
  Live-validated against `~/Documents/local-brain2`.

## Step 2 — Orgs, affiliations, richer people — DONE
- [x] `brain add organization` (find-or-create by name/domain, external-identity dedupe)
- [x] affiliation capture (`add person --org/--title/--current`, `brain affiliate`)
- [x] `person-from-email` optional `--headline/--phone/--location/--title/--org`
- [x] tests, skill, contract. Live-validated: Evensen Design org + Lisa/Erica affiliations.

## Step 3 — Suggestions surface — DONE
- [x] migration 0011 (`suggestions` + `suggestion_links`), schema v11
- [x] `brain suggest project|organization|list|accept|dismiss` (one `Suggest` noun)
- [x] accept create_project → create + relink cited records in one tx
- [x] AGENTS.md guardrail reword + launch-schema.md + skill + contract
- [x] tests. Live-validated: proposed/accepted "West Elizabeth" → project + relinks.

## Step 4 — Thread freshness + evidence-by-quote — DONE
- [x] dedupe reports `bodyChanged`; `--refresh` re-digests only when changed
- [x] `--evidence interaction:<id>~"quote"` resolves chunk by substring
- [x] tests, skill, contract. Live-validated: quote→chunk#1; bodyChanged signal; refresh no-op.

## Post-review fixes (PR #86 review)
- [x] `set_self` no longer stamps an email another active person owns onto the self
  `primary_email` (Bugbot; guarded via `email_owned_by_other`).
- [x] `suggest accept` (organization) now carries the proposed `kind` through
  `find_or_create_organization` (Bugbot).
- [x] Accepting a `create_organization` suggestion no longer auto-affiliates cited
  people — they are evidence, not asserted employees.
- [x] Added 6 black-box integration tests (`tests/cli.rs`) for the new commands' JSON
  contract: self, add organization, affiliate, suggest→accept, `--refresh`/`bodyChanged`,
  evidence-by-quote.
- [x] Skill now states the org-governance boundary: assert when confident, else
  `brain suggest organization`.
- [x] Removed the throwaway demo memory created during live testing of `~quote`.

## Second review round (PR #86)
- [x] `suggest accept` (organization) now relinks cited interactions/documents/projects
  to the org via typed join tables (people are still NOT auto-affiliated) (Bugbot).
- [x] Re-proposing an *open* suggestion now merges newly-cited `--link` evidence
  instead of dropping it; resolved proposals stay untouched (Bugbot).

## Bonus — `brain import-context`
- One-call read-first context for an importing agent: `self` (+ `configured` flag),
  `sources`, existing `projects`/`organizations` to link (capped by `--limit`),
  `openSuggestions`, per-source import watermarks (`imports[].latestAt`), and `counts`.
  Tolerates a brand-new brain (creates + migrates like `status`). Wired into the skill
  as the first step of the import workflow; contract + skill-lint + integration test.

## "Soon"-tier follow-ups (now done in this PR)
- [x] **#6a** Single-current-employer invariant is now a DB constraint — migration 0012
  (schema v12) demotes pre-existing duplicates, syncs `current_organization_id`, and adds
  a partial unique index `ON affiliations(person_id) WHERE is_current=1`. `upsert_affiliation`
  demotes-first so it never trips the index. Cross-writer durable (CLI + desktop).
- [x] **#6b** Rust `normalize_domain` now matches core `normalizeDomain` (strips scheme,
  `www.`, and path), moved into the shared `text.rs` twin. Live: `https://www.x.com/about`
  dedupes to `x.com`.
- [x] **#7** `person-from-email` dup path now fills a blank denormalized `primary_phone`
  (not just headline/location).
- [x] **#8** Skill documents the evidence-quote gotchas (single-line distinctive phrase;
  literal/whitespace-collapsed match; lowest-indexed chunk wins).
- [x] **Bugbot (eea6a61):** `body_changed` recomputes the stored body's hash instead of
  trusting a possibly-null/stale `content_hash`, so a matching body never falsely flags
  `bodyChanged`.
