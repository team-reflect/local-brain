# PR #48 Bugbot fixes — status

State: **all four original findings + one follow-up fixed, tested, and verified locally.**

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
