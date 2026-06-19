# Closed PR Unresolved Comment Audit

Audit date: 2026-06-19
Base: `origin/master` at `04dfb469faa862515f4bff6bb5cd5157efc03bf4`

GitHub review-thread data found 26 unresolved review threads on closed PRs. This audit checks each thread against current `master`.

| PR | Thread | Current status | Notes |
| --- | --- | --- | --- |
| #49 | CLI stores empty body not null | Fixed in this branch | `brain add document` now stores title-only document `body_text` as SQL `NULL`; `brain add interaction` already used nullable body storage. |
| #48 | Email display value discarded | Fixed in this branch | CLI person email handles now preserve trimmed display casing in `people.primary_email` and `person_emails.email`, while dedupe/ownership continues to use `normalized_email`. Bugbot follow-up (PR #70): `add_person_from_email` duplicate path was passing `assessment.email` (lowercased) to `enrich_duplicate_person_email` instead of the trimmed display-cased value; fixed and regression-covered. |
| #48 | Stray markup in plan doc | Fixed in this branch | Removed literal `</content>` and `</invoke>` lines from `docs/pr48-import-identity-guardrails/plan.md`. |
| #39 | Mac checks block icon generation | Fixed in this branch | `generate-icons.mjs` now runs `pnpm tauri icon` before macOS-only checks and exits after cross-platform icon generation on non-macOS. |
| #34 | Windows pnpm spawn fails | Fixed in this branch | `generate-icons.mjs` now uses `pnpm.cmd` on Windows. |
| #29 | Merge conflict marker left in file | Already fixed | `apps/desktop/src/components/first-run.tsx` contains no conflict markers. |
| #29 | Legacy Anthropic migration wrong model | Already fixed | Legacy Anthropic migration now picks the current Anthropic catalog default instead of the obsolete hard-coded model. |
| #21 | Clear key ignores dev env | Already fixed | Startup and refresh now share `resolveProvider`; provider-specific env keys intentionally have one documented precedence path. |
| #21 | Startup ignores saved keychain key | Already fixed | Startup and refresh both use the same resolution function, eliminating the old split precedence. |
| #21 | Palette search needs alphanumeric tokens | Fixed in this branch | The command palette now uses `useQuickSearch`, restoring LIKE-backed record lookup for punctuation/symbol-only queries. |
| #21 | CLI search strips LIKE metacharacters | Already fixed | CLI search now shares escaped LIKE-pattern semantics and uses `LIKE ? ESCAPE '\\'`. |
| #20 | Stray XML tags in doc | Already fixed | `docs/current-state.md` no longer contains the reported literal tags. |
| #19 | Wrong model status copy | Already fixed | First-run copy now says extraction stays off until an AI provider is added and reflects configured/no-model state. |
| #19 | First-run overlay allows background keyboard use | Already fixed | First-run now pushes a blocking modal guard and traps keyboard focus inside the dialog. |
| #18 | Topbar Add uses outline | Obsolete | The old topbar Add button no longer exists; the current topbar is search/navigation only. |
| #17 | Provider refresh ignores env precedence | Already fixed | `refreshModelProvider` and startup both call the shared provider resolver. |
| #17 | Keychain delete ignores failures | Already fixed | `keychain_delete` now treats only success and `errSecItemNotFound` as success; other failures return an error. |
| #17 | Keychain read hides errors | Already fixed | `keychain_get` now returns `None` only for `errSecItemNotFound`; locked/denied keychain errors surface. |
| #17 | IPC failure drops env provider | Already fixed | `resolveProvider` catches keychain errors but still handles env-only provider configuration through the shared path. |
| #16 | Search runs LIKE without FTS | Already fixed | CLI `brain search` now queries FTS tables for documents/interactions/assets and uses LIKE only for name/title rows. |
| #16 | Search limit not capped globally | Already fixed | CLI search merges hits, sorts by score, and truncates once at the requested limit. |
| #16 | Missing scheduled task bucket | Already fixed | CLI task bucketing includes a `scheduled` bucket for future scheduled tasks. |
| #16 | Chunk limits use char count | Already fixed | CLI chunking now counts UTF-16 code units to mirror JavaScript `String.length`. |
| #15 | Ask leaves orphan user turns | Obsolete | The old `packages/core/src/ai/ask.ts` path no longer exists; Ask is now AI SDK transport based. |
| #15 | Draft cleared before Ask succeeds | Already fixed | Current Ask composer restores the draft in the send failure `catch` path. |
| #15 | Source labels mismatch answer citations | Obsolete | The old citation/source-label rendering path no longer exists in the current Ask surface. |
