# Closed PR Comment Audit Status

## Summary

Audited all 26 unresolved review threads found on closed `maccman/local-brain` PRs. Most were already fixed by later merged work or made obsolete by architecture changes. Five still applied and were fixed in this branch.

## Fixes

- CLI documents: title-only documents now store `body_text` as SQL `NULL`.
- CLI people: email handle display values now preserve trimmed input casing, while normalized lookup/dedupe still uses lowercase `normalized_email`.
- Desktop icon script: cross-platform Tauri icon generation no longer depends on macOS-only tools, and Windows uses `pnpm.cmd`.
- Desktop command palette: record search now uses quick-search again, preserving LIKE-backed punctuation/symbol matching.
- Docs: removed stray tool-output markup from `docs/pr48-import-identity-guardrails/plan.md`.

## Verification

- `cargo test -p brain-cli` - pass
- `cargo fmt --check` - pass
- `cargo clippy -p brain-cli -- -D warnings` - pass
- `pnpm check` - pass
- `git diff --check` - pass

## Bugbot Follow-up (PR #70)

Cursor Bugbot (id: 96407394-880c-43ce-b927-73a024db1b06) identified that on the duplicate `add_person_from_email` path, `enrich_duplicate_person_email` was receiving `assessment.email` (already lowercased by `assess_person_import`) instead of the trimmed display-cased value stored by `insert_person_handles` in `person_emails.email`. Fixed by passing `emails.first().map_or(args.email, |e| e.email.as_str())` — the same value the handle row uses — so `people.primary_email` also preserves display casing when enriching a blank field. Added a focused regression test covering mixed-case input on the duplicate path with a blank existing `primary_email`.

## Notes

The raw GitHub GraphQL dump was used for the audit but intentionally left out of the PR to keep the branch small and reviewable.
