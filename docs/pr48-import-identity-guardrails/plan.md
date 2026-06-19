# PR #48 Bugbot fixes — plan

PR: https://github.com/maccman/local-brain/pull/48
Branch: feat/import-identity-guardrails
Review: pullrequestreview-4528908700
Launch head: a7320da266511eaca514e987a19c60808f621cb5

## Four Bugbot findings to fix

1. **Comma names reversed incorrectly** (`apps/cli/src/commands/add.rs`
   `normalize_untrusted_name`). Any two-part comma string is treated as
   `Last, First` and swapped, turning org labels like `Acme, Sales` /
   `Amazon, Customer Service` into fake people that pass the downstream
   person-name guardrail.
   - Fix: only invert when the segment after the comma reads like a real
     given name (single token, optional trailing initial) and neither side
     is a generic role/department term. Leave the comma intact otherwise, and
     make `looks_like_capitalized_person_name` reject comma-bearing tokens so
     un-inverted org strings no longer pass as people.

2. **Interaction dedupe ignores source** (`find_duplicate_interaction`).
   After the source-scoped `external_identities` lookup, the fallback matches
   any non-archived interaction whose `interactions.external_id` equals the
   incoming id regardless of source, so an omitted/different `--source` can
   merge into the wrong upstream message.
   - Fix: thread `source_id` into `find_duplicate_interaction` and only fall
     back to the column match for interactions that are NOT claimed by a
     different source's `external_identities` row (and, when source is
     omitted, only unclaimed/legacy rows).

3. **Empty bracket participants crash** (`parse_raw_participant` /
   `insert_raw_participants`). `from:<>` yields a participant with no
   person_id / normalized_handle / display_name and the insert violates the
   migration 0006 CHECK.
   - Fix: reject participants with no usable identity in
     `parse_raw_participant` (same error path as a missing payload) and add a
     defensive skip in `insert_raw_participants`.

4. **Participant insert breaks constraint** (`packages/core/.../setters.ts`
   `createInteraction`). Participants with only a role / whitespace handle
   insert rows with personId, normalizedHandle, displayName all unset →
   violates migration 0006 CHECK.
   - Fix: normalize displayName/handle, drop participants lacking all three
     identity fields, and only recompute relationship intelligence for kept
     personId rows.

## Acceptance criteria
- All four findings addressed with tests.
- No unrelated refactors.
- Branch pushed to origin feat/import-identity-guardrails.
- final-report.md records files, SHA, verification.

## Verification
- `git diff --check`
- `cargo fmt`, `cargo clippy`, focused `cargo test` for the CLI crate
- focused vitest for `packages/core` interactions setters
- `pnpm check`
