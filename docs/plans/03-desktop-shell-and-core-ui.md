# Plan 03 - Desktop Shell and Core UI

**Goal:** Build the initial Tauri desktop app and a Picardo-inspired shell for personal
memory: grouped sidebar, thin command topbar, dense lists, detail pages, and graph/search
surfaces.

**Depends on:** Plan 01, Plan 02.

**Unlocks:** Plan 04 (manual ingestion UI), Plan 05 (correction UI), Plan 06 (ask/search UI),
Plan 08 (privacy/export UI).

## Scope

**In:** Tauri shell, app routing/state, design system baseline, empty and loaded states,
core views connected to local DB reads, Picardo-inspired navigation and detail layouts.

**Out:** extraction logic, model calls, production packaging, generic table editor.

## Key Decisions

- The first target is macOS desktop.
- The app uses React + TypeScript in a Tauri WebView.
- The default product surface is not a database browser or chat landing page.
- Follow [UI Direction](../ui-direction.md), taking explicit inspiration from
  `/Users/alex/repos/picardo-internal-ui`.
- UI routes:
  - Today
  - Tasks
  - People
  - Projects
  - Places
  - Topics
  - Sources
  - Memories
  - Ask
  - Graph
  - Agent Activity
  - Settings
- Keep the design quiet, dense, keyboard-friendly, and closer to Picardo's editorial
  data-tool feel than a sparse consumer app.

## Implementation Steps

1. Create the Tauri desktop app shell and register basic Rust commands for app status
   and DB availability.
2. Add a small design system foundation: typography, colors, spacing, buttons, inputs,
   dialogs, menus, and tooltips.
3. Add app-level navigation with grouped sidebar sections: Workspace, Memory, AI, and
   System.
4. Implement Today with read-only sections for due tasks, upcoming events, recent
   memories, and follow-ups.
5. Implement list/detail patterns for People, Projects, Places, Topics, Sources,
   Memories, Tasks, and Agent Activity.
6. Implement Ask as a query/answer workspace with citations rather than a full-screen
   chatbot.
7. Implement Graph as a real navigation and sensemaking surface.
8. Add first-run empty states that explain the source-to-memory loop without marketing
   page styling.

## Acceptance Criteria

- The Tauri app launches locally.
- The app can open or create the local SQLite brain.
- Navigation works from keyboard and mouse.
- Empty states guide the user to add a source.
- The UI reads real DB rows where available and handles an empty database gracefully.
- No route exposes a raw table editor as the main product path.
- The shell supports expanded sidebar, collapsed icon rail, mobile drawer, and command
  search trigger.

## Tests or Verification

- Run `pnpm check`.
- Run desktop UI tests for route rendering and empty states.
- Run a smoke test that opens the app with an empty DB.
- Manually verify text does not overflow at desktop and narrow widths.

## Open Questions

- Exact visual identity is unresolved. Default to Picardo's dense editorial data-tool
  posture, translated away from corporate CRM language.
