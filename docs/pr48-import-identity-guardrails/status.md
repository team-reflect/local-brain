# PR #48 Bugbot fixes — status

State: **all four original findings + thirteen follow-ups fixed, tested, and verified locally.**

## Follow-up (fresh current-head Bugbot finding #17, head `ee84f3b`)

Bugbot re-reviewed head `ee84f3b` and flagged one fresh current-head issue, fixed
in `apps/cli/src/commands/add.rs` with focused regression coverage.

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 17 | `91178eb0` (comment `3439998469`) | Medium | Fork sets owned primary email — finding #15 guarded the **enrichment** paths, but `add_person`'s new-record/fork path (after `--allow-duplicate` or any new-person path) still wrote `people.primary_email` from `emails.first()` with no owner check. `insert_person_handles` skips such emails via `email_owned_by_other`, so the fork could show a stolen address on `people.primary_email` with no matching `person_emails` row, breaking the one-person-per-email invariant the duplicate/enrichment paths enforce | The new-person `INSERT` now computes its `primary_email` through `email_owned_by_other` (inside the same transaction): the first email is only stamped onto `people.primary_email` when no other active person owns it, otherwise the column stays NULL — mirroring `enrich_duplicate_person` / `insert_person_handles`. Unowned-email creation is unchanged | `add.rs` `allow_duplicate_fork_does_not_set_owned_primary_email` (confirmed to fail before the fix: the fork's `primary_email` was `Some("alice@example.com")`) |

> Bugbot must re-run against the pushed head before this finding is settled.

## Follow-up (fresh current-head Bugbot findings #15–#16, head `5eba419` → `75d5ac7`)

Bugbot re-reviewed code head `79fbc8a` / docs tip `5eba419` and posted two fresh
current-head issues. Both are fixed in `apps/cli/src/commands/add.rs` with focused
regression coverage.

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 15 | `a658372c` (comment `3439944924`) | High | Enrichment assigns owned email — finding #13 added an owner guard to `insert_person_handles`, but the **denormalized** enrichment path was still unguarded: `enrich_duplicate_person` and `enrich_duplicate_person_email` could fill a blank `people.primary_email` from an incoming address even when another active person already owns it. External-id dedupe could therefore stamp Alice's address onto Bob's `primary_email` while `person_emails` stayed clean | Factored the existing owner check into a shared `email_owned_by_other` helper (now used by `insert_person_handles` too). `enrich_duplicate_person` drops the `primary_email` candidate when another active person owns it; `enrich_duplicate_person_email` returns early in the same case. Legitimate blank-primary enrichment is unaffected | `add.rs` `external_identity_dedupe_does_not_enrich_blank_primary_with_owned_email`, `add_person_from_email_does_not_enrich_blank_primary_with_owned_email` (both confirmed to fail before the fix) |
| 16 | `ceb9574f` (comment `3439944927`) | Medium | Allow-duplicate hits identity constraint — with `--allow-duplicate`, `add_person`/`add_interaction` fork a new record but still call `insert_external_identity` for the same `(source, kind, external_id)`. The unique row already points at the matched active record, so the upsert's `ON CONFLICT DO UPDATE … WHERE` clause silently evaluates false (verified: a graceful no-op on the bundled SQLite, *not* an error — see note) — fragile, and the re-point branch could steal the identity if the matched record were archived | `insert_external_identity` takes a `force_duplicate` flag (threaded via a new `ExternalIdentityWrite` params struct). Forced-duplicate forks use `ON CONFLICT … DO NOTHING`, so they never claim or re-point an existing identity and still insert cleanly when the row is free; the identity stays on the original record. Non-forced re-import behavior (archived re-point, URL refresh) is unchanged | `add.rs` `allow_duplicate_person_does_not_steal_external_identity`, `allow_duplicate_interaction_does_not_steal_external_identity` |

> Note on #16: Bugbot described the symptom as "the statement errors/rolls back."
> On the bundled SQLite this does **not** reproduce — `ON CONFLICT DO UPDATE` with
> a false `WHERE` is a no-op, confirmed both via `sqlite3` and a throwaway test
> against the real code (the fork is created; the identity stays on the original).
> The underlying concern is still valid (fragile reliance on no-op semantics plus a
> latent identity-theft path), so the fix makes the intent explicit with
> `DO NOTHING` and locks it with regression tests.

Verification (run at code head `79fbc8a` + these fixes): `git diff --check`
clean, `cargo fmt -p brain-cli -- --check` clean, `cargo clippy -p brain-cli
--all-targets` no new warnings (only the pre-existing `large_enum_variant` in
`main.rs`), `cargo test -p brain-cli` = 29 unit + 28 integration + 2 skill all
pass. The two finding #15 tests were confirmed to fail before the fix. No JS
touched.

> Bugbot must re-run against the pushed head before findings #15–#16 are settled.

## Follow-up (fresh current-head Bugbot findings #13–#14, head `897c69d` → `79fbc8a`)

Bugbot re-reviewed head `897c69d1b0609a5ada1926a963e5e0ebe96aa58c` (NEUTRAL) and
flagged two fresh current-head issues, both in `insert_person_handles` in
`apps/cli/src/commands/add.rs`.

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 13 | `91f03bec` (comment `3439926606`) | Medium | External dedupe ignores email owner — when `add_person`/`add_person_from_email` resolve a duplicate via `find_external_identity`, they skip the email-based `find_duplicate_person` path but still call `insert_person_handles`. Because `person_emails` is unique only per `person_id`, the same normalized email could be attached to a **second** active person, breaking one-person-per-email | The email loop now skips any address a *different* active person already owns (matching either `lower(people.primary_email)` or `person_emails.normalized_email`, the same columns `find_duplicate_person` uses). It is a no-op on the new-person and email-dedupe paths, so only the external-identity path that bypassed the invariant is affected | `add.rs` `external_identity_dedupe_does_not_steal_another_persons_email` |
| 14 | `edd77a86` (comment `3439926608`) | Low | Primary promotion uses raw strings — promotion compared a denormalized `people.primary_email`/`primary_phone` to imported handles with exact string equality, so a legacy primary that means the **same** lowercased email or differently-formatted phone never received `is_primary = 1` | Emails now compare case-insensitively via `normalize_email`; phones compare on their digit-only `normalize_phone` form (requiring a non-empty normalized value on both sides). The index-0 fallback is unchanged | `add.rs` `legacy_denormalized_primary_syncs_to_handle_despite_formatting` |

Verification (run at head `79fbc8a`): `git diff --check` clean, `cargo fmt -p
brain-cli -- --check` clean, `cargo clippy -p brain-cli --all-targets` no new
warnings (only the pre-existing `large_enum_variant`), `cargo test -p brain-cli`
= 25 unit + 28 integration + 2 skill all pass. Both new tests were confirmed to
fail before their fix. No JS touched.

> Bugbot must re-run against the pushed head before these findings are settled.

## Follow-up (fresh current-head Bugbot finding #12, head `5e09c39`/`bb9cf9d`)

Bugbot re-reviewed head `5e09c39` (NEUTRAL) and flagged one fresh current-head
issue.

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 12 | `82b9d5f2` (comment `3439881613`) | Medium | Duplicate import skips URL refresh — `insert_external_identity`'s `ON CONFLICT DO UPDATE` only ran when `entity_id <> excluded.entity_id`, so a re-import that resolves to the **same active** record skipped the update entirely; a new `--original-url` never refreshed `external_identities.url`, including filling a previously null URL | The `ON CONFLICT` `WHERE` now has a second branch: same active entity **and** a new/changed non-null `excluded.url` also triggers the update. `url` is set via `COALESCE(excluded.url, external_identities.url)` so a URL-less re-import never clobbers an existing URL with NULL. The archived re-point branch is unchanged | `add.rs` `add_person_reimport_refreshes_external_identity_url_on_same_active_record` — fills a null URL, refreshes a changed URL, and asserts a URL-less re-import preserves the stored value (confirmed to fail before the fix with `left: None, right: Some("https://example.com/robin")`) |

Verification (run at this head): `cargo fmt -p brain-cli -- --check` clean,
`cargo test -p brain-cli` = 22 unit + 28 integration + 2 skill all pass. The
regression test was confirmed to fail before the fix and pass after. No JS
touched.

> Bugbot must re-run against the pushed head before finding #12 is settled.

## Follow-up (fresh current-head Bugbot finding #11, head `71bbff6`/`bca58b6`)

Bugbot re-reviewed head `bca58b6` and flagged one fresh current-head issue. It is
fixed in commit `5e09c39a9967fbf8851fe173c19e2c9f7265b965`, with the regression
test strengthened in the follow-up commit.

| # | BUGBOT | Sev | Finding | Fix | Tests |
|---|--------|-----|---------|-----|-------|
| 11 | `5b5ef2e7` (comment `3439870954`) | Medium | Duplicate import marks primary handles — `insert_person_handles` wrote the first email/phone of each incoming batch with `is_primary = 1` by loop index alone, so duplicate-person enrichment that adds only secondary addresses still flagged the new row primary, leaving one person with multiple primary emails or phones | `insert_person_handles` first checks whether the person already owns a primary of each kind (`SELECT EXISTS(… AND is_primary = 1)`); a handle is promoted to primary only when it is first in the batch **and** the person has no existing primary, so new-person creation is unchanged while enrichment never creates a second primary | `add.rs` `duplicate_enrichment_keeps_single_primary_handle` (enrichment lists the brand-new address *first* so the buggy `index == 0` rule would flag it primary — confirmed to fail before the fix with `left: 2, right: 1`) |

Verification (run at this head): `cargo fmt -p brain-cli -- --check` clean,
`cargo test -p brain-cli` = 21 unit + 28 integration + 2 skill all pass. The
regression test was confirmed to fail before the fix (two primary emails) and
pass after.

> Bugbot must re-run against the pushed head before finding #11 is settled.

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
