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
