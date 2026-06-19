# Task Assignees — Final Report

## Branch

`codex/local-brain-task-assignees`

## PR

TBD (will be updated after `gh pr create`)

## Summary

Added first-class task assignees across all layers of Local Brain. People can be designated as task assignees (role=`'assignee'` in the existing `task_people.role` column), distinct from generic task-person associations.

### Changes by layer

| Layer | Files changed | What changed |
|-------|--------------|--------------|
| Core schema | — | No migration needed; `task_people.role TEXT` already existed |
| Core domain | `domains/tasks/getters.ts` | `TASK_PERSON_ROLE_ASSIGNEE`, `listTaskAssignees`, `listAllTaskAssignees`, `TaskAssignee` type |
| Core relations | `domains/relations/getters.ts` | `TaskLinks.assignees` (new), `TaskLinks.people` kept as all-people for backward compat |
| Core extraction | `extraction/contracts.ts` | `assigneeRefs` field on task schema |
| Core extraction | `extraction/apply-tasks.ts` | Processes `assigneeRefs` with role='assignee'; deduplicates vs `personRefs`; confidence gating covers assignees |
| Core reports | `reports/getters.ts` | `BriefTask.assignees` field; `getDailyBrief` batch-loads assignees |
| Core AI | `ai/extractor.ts` | Instructions updated to distinguish `assigneeRefs` from `personRefs` |
| Core exports | `index.ts` | Re-exports new symbols |
| CLI add | `commands/add/task.rs`, `main.rs` | `--assignee <PERSON_ID>` flag (repeatable); JSON output includes `assigneeCount` |
| CLI report | `commands/report.rs` | `fetch_task_assignees` helper; `task_json` includes `assignees`; `daily_brief` and `plan_day` both include assignees |
| Desktop queries | `lib/queries/records.ts` | `useAllTaskAssignees` hook (returns Map<taskId, assignee[]>) |
| Desktop UI | `surfaces/tasks.tsx` | "Assignee" column in task list |
| Desktop UI | `surfaces/detail/task.tsx` | "Assigned to" section in task detail |
| Tests | `db/extraction.test.mjs` | 4 new tests for assignee round-trip, dedup, gating, validation |
| Tests | `apps/cli/tests/cli.rs` | 3 new tests for CLI `--assignee`, `plan_day --json`, `today --json` |
| Docs | `docs/task-assignees/` | `plan.md`, `status.md`, `final-report.md` |

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm check` (typecheck + lint + test) | ✅ All pass |
| `cargo fmt --all -- --check` | ✅ Clean |
| `cargo check --package brain-cli --package brain-schema` | ✅ Clean |
| `cargo test --package brain-cli` | ✅ 51 tests pass (3 new) |
| `pnpm --filter @local-brain/desktop build` | ✅ Vite build succeeds |
| `git diff --check origin/master...HEAD` | ✅ No whitespace issues |

## Caveats

- `summary.links.created` in `applyExtraction` counts all link inserts (source-entity links, not just `task_people`), so tests assert on `summary.people.created` / `summary.tasks.created` instead.
- `cargo check --workspace` requires the Tauri sidecar binary to be staged first (`pnpm --filter @local-brain/desktop sidecar`). Only `brain-cli` and `brain-schema` packages were checked directly.
- `TaskLinks.people` continues to return all task-person links (any role) for backward compatibility. The new `TaskLinks.assignees` field is the filtered view.
