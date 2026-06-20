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
