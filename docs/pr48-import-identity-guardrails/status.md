# PR #48 Bugbot fixes — status

State: **all four original findings + four follow-ups fixed, tested, and verified locally.**

## Follow-up (fresh current-head Bugbot findings #6–#8, head `30e8f13`)

Bugbot re-reviewed head `30e8f13` and posted three fresh current-head issues.
All three are fixed with focused regression tests that fail before the fix.

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 6 | `e0faaa19` (comment `3439797500`) | Medium | External lookup ignores archived records — `find_external_identity` returned an `entity_id` without checking whether the linked person/interaction was archived, so a re-import with the same `--source`/`--external-id` could enrich an archived record and report it as an active duplicate | `find_external_identity` now JOINs the owning entity table (via new `entity_table` map) and filters `t.archived_at IS NULL`, so archived records are never returned as active duplicates; the import falls through to creating a fresh active record | `cli.rs` `add_person_external_id_reimport_skips_archived_record` |
| 7 | `cfedd001` (comment `3439797508`) | Medium | Duplicate person updates not atomic — `add_person` and `add_person_from_email` ran handle/enrichment/external-identity writes as separate autocommit statements, so a late failure left earlier writes committed even though the command errored | Both duplicate paths now wrap their writes in a single `conn.transaction()` … `tx.commit()`, matching the new-person and duplicate-interaction paths | `add.rs` unit tests `add_person_duplicate_path_rolls_back_on_late_failure`, `add_person_from_email_duplicate_path_rolls_back_on_late_failure` |
| 8 | `ac4701ae` (comment `3439797513`) | Low | Name-only participants duplicate reimports — migration 0006's participant unique index only covers rows with a `normalized_handle`, so `INSERT OR IGNORE` re-inserted display-name-only participants (e.g. `from:Casey Jordan <>`) on every duplicate interaction re-import | `insert_raw_participants` now runs an explicit existence check for handle-less participants matching the handle index semantics `(interaction_id, display_name, COALESCE(role, ''))` before inserting | `cli.rs` `add_interaction_reimport_does_not_duplicate_name_only_participant` |

Verification (run at head `30e8f13` + these fixes): `git diff --check` clean,
`cargo fmt -p brain-cli -- --check` clean, `cargo clippy -p brain-cli
--all-targets` no new warnings (only the pre-existing `large_enum_variant`),
`cargo test -p brain-cli` = 18 unit + 28 integration + 2 skill all pass. No JS
touched. Each new test was confirmed to fail before its fix.

> Bugbot must re-run against the pushed head before these findings are settled.

## Follow-up (fresh current-head Bugbot finding)

| BUGBOT | Finding | Fix | Tests | Commit |
|--------|---------|-----|-------|--------|
| `0116a927` (comment `3439779341`) | Route phrase skips stripped names | `assess_person_import` now only pushes `route_phrase` when the route-stripped name does **not** independently read like a capitalized person name. `Robin Spencer via LinkedIn` → `Robin Spencer` is created; `noreply via Mailchimp` → `noreply` is still skipped | `add.rs` unit tests (`route_phrase_strips_to_usable_person_name`, `assess_creates_person_after_stripping_route_phrase`, `assess_skips_route_phrase_noise`) + integration `add_person_from_email_strips_route_phrase_and_creates_person` | `ac5e88f6f070481f5ad4e7452bc89c7fc0bd6d6e` |

Verification (run at head `ac5e88f`): `git diff --check` clean, `cargo fmt -p brain-cli -- --check` clean, `cargo clippy -p brain-cli --all-targets` no new warnings (only the pre-existing `large_enum_variant`), `cargo test -p brain-cli` = 16 unit + 26 integration + 2 skill all pass. No JS touched.

> Bugbot must re-run against the pushed head before this finding is settled.

## Original four findings

State: **all four findings fixed, tested, and verified locally.**

| # | Finding | Fix | Tests |
|---|---------|-----|-------|
| 1 | Comma names reversed incorrectly | `normalize_untrusted_name` only inverts plausible `Last, First` person names; org/role labels keep their comma and the capitalized-name guardrail now rejects comma-bearing tokens | `add.rs` unit tests + `cli.rs` `add_person_from_email_skips_org_comma_labels` |
| 2 | Interaction dedupe ignores source | `find_duplicate_interaction` takes `source_id` and skips interactions claimed by another source (and only unclaimed rows when source omitted) | `cli.rs` `add_interaction_external_id_dedupe_is_source_scoped` + `..._matches_within_same_source` |
| 3 | Empty bracket participants crash | `parse_raw_participant` rejects identity-less `from:<>`; `insert_raw_participants` defensively skips | `add.rs` unit tests + `cli.rs` `add_interaction_rejects_empty_bracket_participant` / `..._keeps_name_only_participant` |
| 4 | Participant insert breaks constraint (TS) | `createInteraction` normalizes + drops identity-less participants, recompute only over kept personId rows | `setters.test.ts` (3 cases) |

## Verification (all green)
- `git diff --check` — clean
- `cargo fmt -p brain-cli --check` — clean
- `cargo clippy -p brain-cli --all-targets` — no new warnings (one pre-existing `large_enum_variant` in `main.rs`, untouched)
- `cargo test -p brain-cli` — 13 unit + 25 integration + 2 skill = all pass
- `pnpm check` (typecheck + lint + test) — all pass (core 165, desktop 77)
</content>
