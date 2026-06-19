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
</content>
