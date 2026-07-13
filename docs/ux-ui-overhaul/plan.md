# UX/UI Overhaul

## Goal

Make Local Brain an honest, actionable workspace: task actions work wherever tasks
appear, navigation behaves predictably, and loading or failure never masquerades as
empty data.

## Decisions

- Use one task lifecycle: `open`, `in_progress`, `waiting`, `blocked`, `done`, and
  `cancelled`. Scheduling is represented by `scheduled_for`, not a lifecycle status.
- Reopening a completed task sets it to `open` and clears `completed_at`.
- Keep task completion visible on the row; move low-frequency destructive actions
  into explicitly labelled menus.
- Reuse task-specific rows across Today, Tasks, and linked-record sections instead of
  teaching the generic linked-record row about workflow behavior.
- Treat desktop detail as route-driven navigation. Modal drawers remain a narrow-window
  fallback in a later slice.

## Delivery

### Slice 1 — Actionable foundations

- symmetric task completion with optimistic rollback and broad cache invalidation
- reusable task completion control and task list rows
- task creation from the Tasks surface and command palette
- completion from Today, task detail, and every linked task section
- honest list/detail error states with retry
- keyboard parity for virtual and non-virtual lists
- Projects navigation, active-state semantics, and router back/forward fixes
- focused cross-surface DOM and domain tests

### Slice 2 — Workspace consistency

- consistent page heads, actions, filters, and actionable empty states
- structured Today agenda, scheduled work, waiting items, and view-all paths
- responsive route-driven detail pane and focus/scroll restoration
- essential person, organization, and project correction controls

### Slice 3 — Surface polish

- compact-window Chat history, stop/retry controls, and clearer approval fields
- Graph zoom/reset/fit controls and keyboard-accessible interactions
- Settings error, pending, confirmation, and recovery states

## Verification

- focused Vitest DOM tests for complete, reopen, rollback, propagation, retry, and
  keyboard behavior
- `pnpm check`
- relevant Rust checks for task CLI and schema migration changes
