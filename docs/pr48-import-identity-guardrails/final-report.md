# PR #48 Bugbot fixes — final report

- PR: https://github.com/maccman/local-brain/pull/48
- Review addressed: pullrequestreview-4528908700 (Cursor Bugbot, 4 comments)
- Branch: `feat/import-identity-guardrails`
- Base: `master` @ `9cd2d844ea0efa19aaf7817e6124c1abce34f4c7` (unchanged during this work)
- Launch head: `a7320da266511eaca514e987a19c60808f621cb5`
- **Code fix commit (all source/test changes): `39d74ff5b2328caf13cfb6d644505fa9663136ec`**
- Branch tip is the docs commit sitting on top of `39d74ff`; Bugbot should
  re-review the current `feat/import-identity-guardrails` tip. The only change
  above `39d74ff` is this `docs/` report (no source/test changes).

> Bugbot must re-run against the pushed head before this PR is considered
> settled. The parent watcher should poll Bugbot for the re-review.

## Follow-up: fresh Bugbot finding on head `f72c9f9`

Bugbot's re-review of `f72c9f9` completed NEUTRAL but posted one new
current-head issue (bug `0116a927-927c-4788-b4f0-1a408b419cc9`, review comment
`3439779341`), addressed in **code-fix commit `ac5e88f6f070481f5ad4e7452bc89c7fc0bd6d6e`**
(parent `f72c9f9`), with docs in the commit on top of it. See finding #5.

## Follow-up: three fresh Bugbot findings on head `30e8f13`

Bugbot re-reviewed head `30e8f13` and posted three new current-head issues
(#6–#8), all addressed in this follow-up commit. Each fix ships with a focused
regression test confirmed to fail before the fix and pass after. See findings
#6, #7, #8 below.

## Files changed (commit 39d74ff)

| File | Change |
|------|--------|
| `apps/cli/src/commands/add.rs` | Fixes #1, #2, #3 + a `#[cfg(test)]` unit module; `#[derive(Debug)]` on `RawParticipant` (needed by tests) |
| `apps/cli/tests/cli.rs` | New end-to-end integration tests for #1, #2, #3 |
| `packages/core/src/domains/interactions/setters.ts` | Fix #4 |
| `packages/core/src/domains/interactions/setters.test.ts` | New vitest suite for #4 |
| `docs/pr48-import-identity-guardrails/*` | plan / status / final-report |

`git diff --stat` (code only): 3 files, +514 / -24.

## Finding-by-finding

### 1. Comma names reversed incorrectly — BUGBOT d4d6c1b0
`normalize_untrusted_name` previously inverted *any* two-part comma string into
`First Last`, turning `Acme, Sales` → `Sales Acme` (a fake person that passed the
capitalized-name guardrail).

Fix: inversion now requires `is_plausible_person_comma_inversion` — the segment
after the comma must read like a given name (single token, optionally a trailing
initial like `A.`), and neither side may be a generic role/department term
(`sales`, `support`, `customer`, `service`, …). Org labels keep their comma, and
`looks_like_capitalized_person_name` now rejects any token containing a comma, so
the un-inverted org string fails the guardrail (`not_capitalized_first_last`)
instead of minting a person. Genuine `Smith, John` / `Rivera, Sam` still invert.

Coverage: `add.rs` unit tests (`comma_inverts_plausible_person_names`,
`comma_keeps_org_labels_intact`, `org_comma_labels_are_not_person_names`,
`assess_skips_org_comma_labels`, `assess_creates_plausible_inverted_person`) and
integration test `add_person_from_email_skips_org_comma_labels`.

### 2. Interaction dedupe ignores source — BUGBOT f340c75a
`find_duplicate_interaction` matched any non-archived interaction whose
`interactions.external_id` column equalled the incoming id, ignoring source, so an
omitted/different `--source` could merge into the wrong upstream message.

Fix: the function now takes `source_id` and the column fallback excludes any
interaction claimed by a *different* source's `external_identities` record (`kind
= 'record'`). When the import omits a source, it only matches unclaimed/legacy
rows. The source-scoped `external_identities` lookup in `add_interaction` continues
to handle the same-source match first; legacy sourceless dedupe still works.

Coverage: `add_interaction_external_id_dedupe_is_source_scoped` (gmail vs zoom vs
sourceless all stay distinct → 3 rows) and
`add_interaction_external_id_dedupe_matches_within_same_source` (same source still
dedupes). Pre-existing `add_interaction_dedupes_by_external_id_and_enriches_provenance`
(legacy sourceless dedupe) still passes.

### 3. Empty bracket participants crash — BUGBOT e38b3fc4
`parse_raw_participant("from:<>")` produced a participant with no person_id,
normalized_handle, or display_name → the insert violated the migration 0006 CHECK.

Fix: `parse_raw_participant` now rejects an identity-less payload with the same
`"--participant '…' is missing a name or handle"` error used for an empty payload,
and `insert_raw_participants` defensively skips any participant that still lacks
both a handle and a display name. Name-only `from:Name <>` remains valid.

Coverage: `add.rs` unit tests (`parse_participant_rejects_empty_brackets`,
`parse_participant_keeps_named_and_handled`, `parse_participant_skips_blank`) and
integration tests `add_interaction_rejects_empty_bracket_participant` (command
fails, transaction rolls back, zero rows) / `add_interaction_keeps_name_only_participant`.

### 4. Participant insert breaks constraint (TS) — BUGBOT 9a1af462
`createInteraction` could insert participant rows carrying only a role or a
whitespace handle, leaving personId/normalizedHandle/displayName all unset →
violates migration 0006 CHECK.

Fix: `buildParticipantRow` normalizes displayName/handle (trim, lowercase email
handles), drops any participant with none of personId/normalizedHandle/displayName,
and relationship recompute now runs only over the participants actually inserted.

Coverage: `setters.test.ts` — drops identity-less participants, keeps+normalizes
valid ones, keeps a personId-only participant.

### 5. Route phrase skips stripped names — BUGBOT 0116a927 (head f72c9f9)
`assess_person_import` always pushed the `route_phrase` reason code whenever the
display name contained a routing marker (` via `, ` from `, ` at `), even though
`normalize_untrusted_name` had already stripped the marker to a clean name. As a
result legitimate senders like `Robin Spencer via LinkedIn` normalized to a
usable `Robin Spencer` but were still skipped with no person created.

Fix: the `route_phrase` reason is now only pushed when the residual name does
*not* independently read like a capitalized person name
(`has_route_phrase && !looks_like_capitalized_person_name(&normalized_name)`).
Stripped real names flow through the normal guardrails and create a person, while
noise such as `noreply via Mailchimp` → `noreply` is still flagged and skipped.

Coverage: `add.rs` unit tests `route_phrase_strips_to_usable_person_name`,
`assess_creates_person_after_stripping_route_phrase` (covers ` via `/` from `/
` at ` variants), and the negative `assess_skips_route_phrase_noise`; plus the
new integration test
`add_person_from_email_strips_route_phrase_and_creates_person`.

### 6. External lookup ignores archived records — BUGBOT e0faaa19 (head 30e8f13)
`find_external_identity` returned the `entity_id` straight from
`external_identities` without checking whether the linked person/interaction was
archived. Every other dedupe path filters `archived_at IS NULL`, so a re-import
with the same `--source`/`--external-id` could enrich an *archived* record,
report it as a duplicate, and leave the data off normal active lists.

Fix: a new `entity_table` map resolves an `entity_type` to its owning table
(`person → people`, `interaction → interactions`, …; every typed record table
carries `archived_at`). `find_external_identity` now JOINs that table and adds
`AND t.archived_at IS NULL`, so an archived record is never returned as an active
duplicate. Active source-scoped behavior is unchanged; an unknown entity type is
a clear runtime error. When the only match is archived, the import falls through
to creating a fresh active record.

Coverage: `cli.rs` `add_person_external_id_reimport_skips_archived_record`
(import → archive → re-import with the same source/external id → a new active
person is created, the archived row stays archived).

### 7. Duplicate person updates not atomic — BUGBOT cfedd001 (head 30e8f13)
When a duplicate person was detected, `add_person` and `add_person_from_email`
ran `insert_person_handles`, the enrichment update, and `insert_external_identity`
as three separate autocommit statements. If a later step failed, the earlier
handle/email writes stayed committed even though the command returned an error —
unlike new-person creation and duplicate-interaction handling, which use a
transaction.

Fix: both duplicate paths now open a single `conn.transaction()`, perform the
handle/enrichment/external-identity writes against the `tx`, and `tx.commit()`
only on success. A late failure rolls the whole duplicate update back.

Coverage: `add.rs` unit tests `add_person_duplicate_path_rolls_back_on_late_failure`
and `add_person_from_email_duplicate_path_rolls_back_on_late_failure`. Each seeds
an active person, drops `external_identities` so the final write fails (the
source-scoped lookup degrades to "no match" gracefully), then asserts the
duplicate-path handle/enrichment writes were rolled back.

### 8. Name-only participants duplicate reimports — BUGBOT ac4701ae (head 30e8f13)
`insert_raw_participants` uses `INSERT OR IGNORE`, but migration 0006 only defines
a unique index for `(interaction_id, normalized_handle, COALESCE(role, ''))` when
`normalized_handle` is set. Participants with only a `display_name` (e.g.
`from:Casey Jordan <>`) have no covering uniqueness rule, so each duplicate
interaction re-import appended another identical row.

Fix: before inserting a handle-less participant, `insert_raw_participants` now
runs an explicit existence check matching the handle index's semantics —
`interaction_id = ? AND normalized_handle IS NULL AND display_name = ? AND
COALESCE(role, '') = ?` — and skips the insert when a matching row already
exists. No migration was added; the check mirrors the existing schema style.

Coverage: `cli.rs` `add_interaction_reimport_does_not_duplicate_name_only_participant`
(re-import the same sourced/external-id interaction with the same name-only
participant → exactly one participant row).

## Verification (follow-up, run at head 30e8f13 + findings #6–#8)

| Command | Result |
|---------|--------|
| `git diff --check` | clean |
| `cargo fmt -p brain-cli -- --check` | clean |
| `cargo clippy -p brain-cli --all-targets` | no new warnings; one pre-existing `large_enum_variant` in `main.rs` (untouched, out of scope) |
| `cargo test -p brain-cli` | 18 unit + 28 integration + 2 skill — all pass (incl. 4 new tests for #6–#8) |

Each new test was confirmed to fail against the pre-fix code and pass after. No
JS was touched in this follow-up.

## Verification commands & results (run at head 39d74ff)

| Command | Result |
|---------|--------|
| `git diff --check` | clean |
| `cargo fmt -p brain-cli -- --check` | clean |
| `cargo clippy -p brain-cli --all-targets` | no new warnings; one pre-existing `large_enum_variant` in `main.rs` (untouched, out of scope) |
| `cargo test -p brain-cli` | 13 unit + 25 integration + 2 skill — all pass |
| `pnpm --filter @local-brain/core exec vitest run src/domains/interactions/setters.test.ts` | 3/3 pass |
| `pnpm check` (typecheck + lint + test) | all pass — core 165 tests, desktop 77 tests |

## Caveats
- Fix #1 is a heuristic. To stay safe it errs toward *not* creating a person:
  rare real names whose given/surname segment is a generic role word (e.g. a
  literal surname "Service") or directory entries with two full given names
  (`Smith, Mary Jane`) are left un-inverted and skipped rather than risk minting
  a wrong person. The generic-role list mirrors the locals already used by
  `is_machine_email`.
- Fix #3 turns an identity-less participant into a hard error (consistent with
  the existing empty-payload behavior), so an import line with `from:<>` fails the
  whole interaction add rather than silently dropping that participant. The
  defensive skip in `insert_raw_participants` guards the DB invariant regardless.
- The pre-existing `large_enum_variant` clippy warning in `main.rs` was left as-is
  to honor the "no unrelated refactors" constraint.
- Bugbot has not yet re-reviewed the pushed head; this report reflects local
  verification only.

## Follow-up verification (finding #5, run after the f72c9f9 re-review)

| Command | Result |
|---------|--------|
| `cargo fmt --check` (in `apps/cli`) | clean |
| `cargo clippy --all-targets` (in `apps/cli`) | no new warnings; only the pre-existing `large_enum_variant` in `main.rs` (untouched, out of scope) |
| `cargo test` (in `apps/cli`) | 16 unit + 26 integration + 2 skill — all pass (incl. 3 new route_phrase unit tests) |

## Follow-up: Bugbot NEUTRAL re-review on head `4166204` (2 fresh issues)

Cursor Bugbot re-reviewed head `416620408edbb8e82f013649b08ec830a03a9307` and
flagged two new current-head issues. Both are fixed in commit
**`c2988ff898fedc5ed24e0984d3a6e3b917b78f34`**.

### 1. Archived reimport loses external identity — BUGBOT 4de6e6a1 (comment 3439826634)
`apps/cli/src/commands/add.rs` — after an archived person/interaction is
re-imported with the same `--source`/`--external-id`, `insert_external_identity`
used `INSERT OR IGNORE` while the unique `(source_id, kind, external_id)` row
still pointed at the archived entity. The new active record never received an
identity row, so later imports skipped `find_external_identity` (which only
matches active rows) and could miss dedupe.

Fix: `insert_external_identity` now upserts via
`ON CONFLICT (source_id, kind, external_id) DO UPDATE … WHERE` the existing
identity points at a *different* entity **and** that entity is no longer active
(`NOT EXISTS … archived_at IS NULL` against the entity's owning table). This
re-points a stale identity from an archived record onto the new active record
while never clobbering an identity that still maps to a live record (mirroring
`find_external_identity`'s active-only scope). Regression tests:
`add_person_reimport_after_archive_repoints_external_identity` (re-point + later
dedupe reuses the active record) and
`add_person_reimport_does_not_clobber_active_external_identity` (active identity
left untouched).

### 2. TS creates duplicate name-only participants — BUGBOT 9d74880a (comment 3439826640)
`packages/core/src/domains/interactions/setters.ts` — `createInteraction`
inserted every built participant row with no dedupe. Migration 0006 only
unique-indexes rows with a `normalized_handle`, so the desktop batch path could
persist duplicate identical unresolved (name-only) participants in one create —
the case the CLI already guards on re-import.

Fix: `createInteraction` now dedupes built participant rows by an identity key
that mirrors migration 0006's unique indexes plus the CLI's name-only guard —
person rows key on `(interactionId, personId)`, handle rows on
`(interactionId, normalizedHandle, role)`, and name-only rows on
`(interactionId, displayName, role)`. Regression tests:
`dedupes identical name-only participants in one create` and
`dedupes duplicate handle and personId participants in one create`.

### Verification (run before commit)

| Command | Result |
|---------|--------|
| `cargo test -p brain-cli` | 20 unit + 28 integration + 2 skill — all pass (incl. 2 new reimport unit tests) |
| `cargo fmt -p brain-cli -- --check` | clean |
| `cargo clippy -p brain-cli --tests` | no new warnings; only the pre-existing `large_enum_variant` in `main.rs` (untouched) |
| `pnpm --filter @local-brain/core exec vitest run src/domains/interactions/setters.test.ts` | 5/5 pass (incl. 2 new dedupe tests) |
| `pnpm --filter @local-brain/core typecheck` | clean |
| `pnpm exec oxlint packages/core/src/domains/interactions` | clean |

## Follow-up: Bugbot NEUTRAL re-review on head `71bbff6` (1 fresh issue)

Cursor Bugbot re-reviewed head `71bbff6fa865c4b9000f5d9267f51e697b3a525d` and
flagged one new current-head issue, fixed in this follow-up.

### Duplicate import marks primary handles — BUGBOT 5b5ef2e7 (comment 3439870954)
`apps/cli/src/commands/add.rs` — `insert_person_handles` always wrote the first
email/phone of each incoming batch with `is_primary = 1` based on loop index
alone. On duplicate-person enrichment, a re-import that adds only secondary
addresses still flagged the new row as primary, so one person could accumulate
multiple primary emails or phones.

Fix: before each loop, `insert_person_handles` now checks whether the person
already owns a primary handle (`SELECT EXISTS(... AND is_primary = 1)`). A handle
is promoted to primary only when it is the first of the batch **and** the person
has no existing primary of that kind. New-person creation (which has no prior
handles) still marks its first email/phone primary; duplicate enrichment leaves
the established primary untouched.

Coverage: `add.rs` unit test `duplicate_enrichment_keeps_single_primary_handle`
seeds a new person (asserting exactly one primary email and one primary phone),
re-imports the same person with an added secondary email and phone, then asserts
both secondary rows were added while the primary counts stay at exactly one. The
enrichment batch lists the brand-new address *first* (with the existing primary
trailing so the duplicate still resolves to this person), so the index-0 slot is
a genuinely new row — the buggy `index == 0` rule promotes it and the test fails
before the fix (`left: 2, right: 1` primary emails); it passes after.

### Verification (run before commit)

| Command | Result |
|---------|--------|
| `cargo test -p brain-cli` | 21 unit + 28 integration + 2 skill — all pass (incl. 1 new primary-handle test) |
| `cargo fmt -p brain-cli` | clean |
| `cargo clippy -p brain-cli --all-targets` | no new warnings; only the pre-existing `large_enum_variant` in `main.rs` (untouched) |

## Follow-up: Bugbot re-review on head `bb9cf9d` (1 fresh issue)

Cursor Bugbot re-reviewed head `bb9cf9d47397ec7c7a53e054ca33278295250c23` and
flagged one new current-head issue, fixed in commit
**`5d5532956ccc37b7896421a212935548eebc089d`**.

### Duplicate import skips URL refresh — BUGBOT 82b9d5f2 (comment 3439881613)
`apps/cli/src/commands/add.rs` — `insert_external_identity`'s
`ON CONFLICT (source_id, kind, external_id) DO UPDATE` only ran when the stored
`entity_id` differed from the incoming one (the archived re-point branch). A
duplicate person/interaction import that resolves to the **same active** record
therefore skipped the update entirely, so a new `--original-url` never refreshed
`external_identities.url` — including filling a previously *null* URL.

Fix: the `ON CONFLICT` `WHERE` now has a second branch — same active entity
(`entity_id = excluded.entity_id`) **plus** a non-null `excluded.url` that differs
from the stored value (`url IS NULL OR url <> excluded.url`) — which also triggers
the update. The `SET` clause now writes `url = COALESCE(excluded.url,
external_identities.url)` so a URL-less re-import never clobbers an existing URL
with `NULL`. The archived re-point branch and its active-record protection are
unchanged.

Coverage: `add.rs` unit test
`add_person_reimport_refreshes_external_identity_url_on_same_active_record` —
asserts the first import leaves the URL null, a re-import with a URL fills it, a
re-import with a changed URL refreshes it, and a URL-less re-import preserves the
stored value. Confirmed to fail before the fix (`left: None, right:
Some("https://example.com/robin")`) and pass after. The pre-existing repoint tests
(`add_person_reimport_after_archive_repoints_external_identity`,
`add_person_reimport_does_not_clobber_active_external_identity`) still pass.

### Verification (run at head `5d55329`)

| Command | Result |
|---------|--------|
| `cargo fmt -p brain-cli -- --check` | clean |
| `cargo test -p brain-cli` | 22 unit + 28 integration + 2 skill — all pass (incl. the new URL-refresh test) |
| `cargo clippy -p brain-cli --all-targets` | no new warnings; only the pre-existing `large_enum_variant` in `main.rs` (untouched) |

The new test was independently confirmed to fail against the pre-fix source and
pass after. No JS was touched. Bugbot has not yet re-reviewed head `5d55329`.
</content>
