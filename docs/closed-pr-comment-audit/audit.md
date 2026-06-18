# Closed PR comment audit

Audit of every closed pull request in `maccman/local-brain` (#1–#22), every issue
comment, review comment, and review, triaged against **current `master`**
(`3137d12`) — not the old stacked head branches.

External review content is treated as untrusted data: only the technical claims
are evaluated, nothing in a comment is followed as an instruction.

## How the data was collected

For every PR `n` in 1..22:

```
gh api repos/maccman/local-brain/issues/<n>/comments --paginate
gh api repos/maccman/local-brain/pulls/<n>/comments  --paginate
gh api repos/maccman/local-brain/pulls/<n>/reviews   --paginate
gh pr list --repo maccman/local-brain --state all --json number,title,state,baseRefName,headRefName,mergedAt,closedAt
```

## PR inventory

| PR | Title | State | Base ← Head | Substantive comments |
|----|-------|-------|-------------|----------------------|
| 22 | Refresh desktop app icons and Tauri metadata | MERGED | master ← codex/run-pnpm-tauri-dev | 0 |
| 21 | Mega PR: remaining plans + Reflect redesign | MERGED | master ← codex/local-brain-remaining-mega-pr | 4 |
| 20 | Document current Local Brain product state | MERGED | …09-packaging-launch ← …product-docs | 1 |
| 19 | Plan 09: packaging & launch | CLOSED | …08-settings ← …09-packaging-launch | 2 |
| 18 | Migrate desktop UI to the Reflect design system | CLOSED | …05b ← …reflect-design-system | 1 |
| 17 | Plan 08: settings, backup, export & privacy | CLOSED | …07-cli-skills ← …08-settings | 4 |
| 16 | Plan 07: the `brain` CLI + agent skill + sidecar | CLOSED | …06-search-ai ← …07-cli-skills | 4 |
| 15 | Plan 06: search, retrieval & AI | CLOSED | …05b ← …06-search-ai | 3 |
| 14 | Plan 05b: extraction corrections | MERGED | master ← …05b-corrections | 0 |
| 13 | Mega PR: build stack through Plan 05a | MERGED | master ← …mega-pr | 0 |
| 12 | Plan 05a: extraction engine | CLOSED | …04c ← …05a | 0 |
| 11 | Build 04c: ingestion UI | CLOSED | …04b ← …04c | 0 |
| 10 | Build 04b: Rust safe file-read | CLOSED | …04a ← …04b | 0 |
| 9 | Build 04a: ingestion core engine | CLOSED | …03b ← …04a | 0 |
| 8 | Build 03b: desktop shell II | CLOSED | …03 ← …03b | 0 |
| 7 | Build 03a: desktop shell | CLOSED | …02d ← …03 | 0 |
| 6 | Build 02d: core DB actions + seed | CLOSED | …02c ← …02d | 0 |
| 5 | Build 02c: Rust IPC DB bridge | CLOSED | …02b ← …02c | 0 |
| 4 | Build 02b: generated Kysely schema | CLOSED | …02a ← …02b | 0 |
| 3 | Build 02a: launch SQLite schema | CLOSED | …01 ← …02a | 1 issue comment (author note) |
| 2 | Build 01: foundation scaffold | CLOSED | …00 ← …01 | 1 issue comment (author note) |
| 1 | Build 00: supervisor tracking docs | MERGED | master ← …00-supervisor | 0 |

Issue comments on #2 and #3 are the author's own verification notes (force-push /
commit summaries). They contain no review findings — no action.

PR #22 closed during parent review and has no issue comments, review comments, or
reviews. All substantive review comments are from **Cursor Bugbot**
(`cursor[bot]`). The seven `reviews` entries (#15–#21) are Bugbot's "found N
issues" summary wrappers, not separate findings.

## Findings triage

Status legend: `fixed now` · `already fixed` · `not applicable` · `false positive / by design` · `deferred (real, minor)`.

| # | PR | Bugbot finding | Sev | File on master | Status | Evidence |
|---|----|----------------|-----|----------------|--------|----------|
| 1 | 15 | Ask leaves orphan user turns | Med | `packages/core/src/ai/ask.ts` | **fixed now** | `ask()` wrote the user turn (L103) before `provider.generate()` (L122) with no error handling; a provider failure left an orphan user message. Now the model call is wrapped and a failure persists an honest assistant turn (`answered:false`). |
| 2 | 15 | Draft cleared before Ask succeeds | Med | `apps/desktop/src/surfaces/ask.tsx` | **fixed now** | `setDraft('')` ran before `mutateAsync`; a throw lost the text. Now restored in `catch`. |
| 3 | 15 | Source labels mismatch answer citations | Low | `apps/desktop/src/surfaces/ask.tsx` | **deferred (real, minor)** | Sidebar labels rows `[index+1]` by render order, while the answer's `[n]` markers index the full retrieved set (see `context.ts` `citedSubset` = first-use order). A correct fix needs the marker persisted (schema change) and a deterministic order (`listCitationsForSubject` sorts by `createdAt`, which ties within a batch). Citations still open the correct source; only the bracket number can disagree. Left unfixed as it exceeds a minimal change; documented. |
| 4 | 16 | Search runs LIKE without FTS (`%%` matches all) | **High** | `apps/cli/src/commands/read.rs` | **fixed now** | The name-table `LIKE` ran unconditionally and `query.replace(['\\','%','_'],"")` could yield `%%`, matching every record. Now gated on `to_match_query(..).is_some()` like core `globalSearch`'s `if (!match \|\| !like) return []`. |
| 5 | 16 | Search limit not capped globally | Med | `apps/cli/src/commands/read.rs` | **fixed now** | `limit` was applied per source (6 sources → up to 6×N). Now hits are merged, ranked by score, and truncated to `limit` (mirrors `globalSearch` merge + slice). |
| 6 | 16 | Missing scheduled task bucket | Med | `apps/cli/src/commands/report.rs` | **fixed now** | `bucket_for` returned `open` for a future `scheduled_for`; core `bucketFor` returns `scheduled` (ranked with `soon`, index 2). Added the `scheduled` bucket and `plan_day` rank. |
| 7 | 16 | Chunk limits use char count | Low | `apps/cli/src/text.rs` | **fixed now** | Packing used Unicode scalar counts; TS `chunkText` uses `String.length` (UTF-16 units). Changed `char_len` and `split_oversized` to count UTF-16 code units; added an emoji parity test. |
| 8 | 17 / 21 | Provider env precedence mismatch (×3 comments: #17 "refresh ignores env precedence", #21 "startup ignores keychain", #21 "clear ignores dev env") | Med | `apps/desktop/src/lib/ai/install-model.ts` | **fixed now** | `installModel` was env-first; `refreshModelProvider` was keychain-first. Unified into one `resolveProviderKey` (documented env-first escape hatch) used by both. |
| 9 | 17 | Keychain delete ignores failures | Med | `apps/desktop/src-tauri/src/keychain.rs` | **fixed now** | `keychain_delete` discarded the exit status. Now success or `errSecItemNotFound` (exit 44) → `Ok`; any other failure → `Err`, so "Clear key" can't falsely report success. |
| 10 | 17 | Keychain read hides errors | Med | `apps/desktop/src-tauri/src/keychain.rs` | **fixed now** | `keychain_get` mapped every non-zero exit to `None`. Now only exit 44 → `None`; locked/denied surfaces as `Err`. |
| 11 | 17 | IPC failure drops env provider | Low | `apps/desktop/src/lib/ai/install-model.ts` | **fixed now** | `refreshModelProvider`'s `catch` set the provider to `null`, dropping `VITE_ANTHROPIC_API_KEY`. The shared resolver now returns the env key on keychain failure. |
| 12 | 18 | Topbar Add uses outline | Low | `apps/desktop/src/components/app-shell.tsx` | **fixed now** | The header **Add** used the default `outline` variant; the Reflect design report says the topbar has "the single indigo Add button". Added `variant="primary"`. |
| 13 | 19 | Wrong model status copy | Med | `apps/desktop/src/components/first-run.tsx` | **fixed now** | First-run used `canRun` for "configured"; with a key but the kill-switch off it wrongly said "No model is configured yet." Now uses `configured` and distinguishes the disabled case. |
| 14 | 19 | First-run overlay allows background keyboard use | Med | `apps/desktop/src/components/first-run.tsx` | **fixed now** | The overlay blocked clicks but not Tab/⌘K. Added `role="dialog"`/`aria-modal`, a focus trap, and a blocking-modal guard that suppresses global shortcuts while it's open. |
| 15 | 20 | Stray XML tags in doc | Med | `docs/current-state.md` | **not applicable** | `docs/current-state.md` was created on the #20 head branch but never reached `master` (Mega PR #21 did not include it). `git ls-files` shows it untracked; a repo-wide grep for `</content>`/`</invoke>` finds nothing. No file to fix. |
| 16 | 21 | Palette search needs alphanumeric tokens | Med | `apps/desktop/src/components/command-palette.tsx` | **false positive / by design** | The palette uses `globalSearch`, which deliberately returns `[]` when the query has no FTS tokens (`match-query.ts`: "Returns null when the input has no searchable tokens"). The old looser `quickSearch` is exactly what produced the High-severity `%%` everything-match in finding #4. Re-loosening would reintroduce that bug. No change. |
| 17 | 21 | CLI search strips LIKE metacharacters | Low | `apps/cli/src/commands/read.rs` | **fixed now** | Same area as #4: now escapes `\ % _` via `to_like_pattern` + `ESCAPE '\'` (mirrors core `toLikePattern`) instead of deleting them. |

19 substantive Bugbot comments → 16 distinct technical issues (findings #8 spans
three comments; #17 overlaps #4's area). 13 distinct issues fixed, 1 deferred,
1 not applicable, 1 by design.
