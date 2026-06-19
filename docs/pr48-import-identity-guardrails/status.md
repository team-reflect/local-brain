# PR #48 Bugbot fixes — status

State: **all four original findings + six follow-ups fixed, tested, and verified locally.**

## Follow-up (fresh current-head Bugbot findings #9–#10, head `4166204`)

Bugbot re-reviewed head `416620408edbb8e82f013649b08ec830a03a9307` and flagged two
fresh current-head issues. Both are fixed in commit
`c2988ff898fedc5ed24e0984d3a6e3b917b78f34` (the TS dedupe separator was kept
text-safe in `71bbff6`).

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 9 | `4de6e6a1` (comment `3439826634`) | Medium | Archived reimport loses external identity — after an archived person/interaction is re-imported with the same `--source`/`--external-id`, `insert_external_identity` used `INSERT OR IGNORE` while the unique `(source_id, kind, external_id)` row still pointed at the archived entity, so the new active record never got an identity row and later imports skipped `find_external_identity` (active-only) and could miss dedupe | `insert_external_identity` now upserts via `ON CONFLICT (source_id, kind, external_id) DO UPDATE … WHERE` the existing identity points at a *different* entity **and** that entity is no longer active (`NOT EXISTS … archived_at IS NULL` against the entity's owning table), re-pointing a stale identity from an archived record onto the new active one without ever clobbering a live identity | `add.rs` `add_person_reimport_after_archive_repoints_external_identity`, `add_person_reimport_does_not_clobber_active_external_identity` |
| 10 | `9d74880a` (comment `3439826640`) | Low | TS creates duplicate name-only participants — `createInteraction` inserted every built participant row with no dedupe; migration 0006 only unique-indexes rows with a `normalized_handle`, so the desktop batch path could persist duplicate identical name-only participants in one create | `createInteraction` now dedupes built rows by a `participantIdentityKey` mirroring 0006's unique indexes plus the CLI name-only guard — personId rows on `(interactionId, personId)`, handle rows on `(interactionId, normalizedHandle, role)`, name-only rows on `(interactionId, displayName, role)`; the key separator uses an escaped `\u0000` so the source stays valid text | `setters.test.ts` `dedupes identical name-only participants in one create`, `dedupes duplicate handle and personId participants in one create` |

Verification (run at head `71bbff6`): `git diff --check` clean, `cargo fmt -p
brain-cli -- --check` clean, `cargo clippy -p brain-cli --all-targets` no new
warnings (only the pre-existing `large_enum_variant`), `cargo test -p brain-cli`
= 20 unit + 28 integration + 2 skill all pass, `pnpm --filter @local-brain/core
exec vitest run src/domains/interactions/setters.test.ts` = 5/5 pass, plus
`@local-brain/core` typecheck + `oxlint packages/core/src/domains/interactions`
clean. Each new test was confirmed to fail before its fix.

> Bugbot must re-run against the pushed head before findings #9–#10 are settled.

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
