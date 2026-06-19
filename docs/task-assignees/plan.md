# Task Assignees — Implementation Plan

## Background

Local Brain already has `task_people(task_id, person_id, role)` in the launch schema. The `role` field is TEXT and can be NULL (generic person link) or a specific value. This feature uses `role = 'assignee'` as the canonical representation for task assignment. No schema migration is required.

## Design Decisions

### No new column on `tasks`
`tasks.assignee_id` would allow only one assignee. The join table supports multiple assignees and preserves the generic-link semantic for other person relationships. We use the existing join table.

### Role constant
`TASK_PERSON_ROLE_ASSIGNEE = 'assignee'` is the canonical value. Other role values may exist in the future (e.g. 'reviewer', 'watcher') but are out of scope here.

### Backward compatibility
- Existing `personRefs` in extraction still insert with `role = NULL` (generic link).
- New `assigneeRefs` insert with `role = 'assignee'`.
- If a person appears in both, a single row is inserted with `role = 'assignee'` (more specific wins).
- `TaskLinks.people` continues to return ALL task-person links for backward compat. New `TaskLinks.assignees` returns only role='assignee' links.

### Extraction confidence gating
`assigneeRefs` are treated as task dependencies exactly like `personRefs`. If any assignee ref is gated out below the confidence threshold, the entire task is held back as a suggestion.

## Changes by Layer

### Schema
- No change. `task_people.role TEXT` already exists.

### Core — `packages/core/src/domains/tasks/getters.ts`
- Export `TASK_PERSON_ROLE_ASSIGNEE = 'assignee'`
- Add `TaskAssignee` interface: `{taskId, personId, personName}`
- Add `listTaskAssignees(taskId)` → `TaskAssignee[]` (per task)
- Add `listAllTaskAssignees()` → `TaskAssignee[]` (all tasks, for bulk UI)

### Core — `packages/core/src/domains/relations/getters.ts`
- Add `assignees: LinkedRecord[]` field to `TaskLinks`
- `getTaskLinks` fetches assignees (role='assignee') in parallel

### Core — `packages/core/src/reports/getters.ts`
- Add `assignees: {id: string; name: string}[]` to `BriefTask`
- `getDailyBrief` batch-loads assignees for all open tasks in one SQL query

### Core — `packages/core/src/extraction/contracts.ts`
- Add `assigneeRefs: z.array(ref).default([])` to `extractedTaskSchema`
- `validateExtraction` validates `assigneeRefs` as person refs (parallel to `personRefs`)

### Core — `packages/core/src/extraction/apply-tasks.ts`
- Include `assigneeRefs` in the dependency check (gates task if any assignee is gated)
- Insert `assigneeRefs` with `role = 'assignee'`
- Skip `personRefs` that already appear in `assigneeRefs` (dedup, assignee role wins)

### Core — `packages/core/src/ai/extractor.ts`
- Update `INSTRUCTIONS` to mention `assigneeRefs` in tasks schema
- Add guidance: use `assigneeRefs` for the person responsible for doing the task

### Core — `packages/core/src/index.ts`
- Export `TASK_PERSON_ROLE_ASSIGNEE`, `TaskAssignee`, `listTaskAssignees`, `listAllTaskAssignees`

### CLI — `apps/cli/src/main.rs`
- Add `#[arg(long, value_name = "PERSON_ID")]  assignee: Vec<String>` to `AddTaskArgs`
- Pass `assignee_ids` to `add::add_task`
- Update `contract()` to document `addTask.assigneeFlag`

### CLI — `apps/cli/src/commands/add/task.rs`
- Add `assignee_ids: Vec<String>` to `AddTaskArgs`
- After inserting link rows, insert assignees with `role = 'assignee'`
- Include `assigneeCount` in JSON output

### CLI — `apps/cli/src/commands/report.rs`
- `fetch_task_assignees(conn)` → `HashMap<String, Vec<Value>>` (all assignees, one query)
- `task_json` gains `assignees: [{id, name}]` field
- All callers (`daily_brief`, `plan_day`) pass the assignee map

### Desktop — `apps/desktop/src/lib/queries/records.ts`
- Add `useAllTaskAssignees()` using `listAllTaskAssignees`

### Desktop — `apps/desktop/src/surfaces/tasks.tsx`
- Add "Assignee" column using the assignees map hook

### Desktop — `apps/desktop/src/surfaces/detail/task.tsx`
- Show "Assigned to" for `links.data.assignees`
- Show "People" for non-assignee task-person links

## Tests Added

1. Extraction contract: `assigneeRefs` validates as person refs, fails for non-person refs
2. Apply: `assigneeRefs` → `task_people.role = 'assignee'`; `getTaskLinks.assignees` exposes them
3. Dedup: person in both `personRefs` and `assigneeRefs` → single row with role='assignee'
4. Confidence gating: task held back when assignee ref is below threshold
5. CLI: `brain add task --assignee <id>` creates row with role='assignee'; JSON output includes assignees
6. CLI: `brain tasks plan-day --json` includes assignees per task
