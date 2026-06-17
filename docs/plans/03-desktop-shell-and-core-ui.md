# Plan 03 - Desktop Shell and Core UI

**Goal:** Build the initial Tauri desktop app and the core navigation surfaces around
Today, Inbox, Ask/Search, and Entities.

**Depends on:** Plan 01, Plan 02.

**Unlocks:** Plan 04 (manual ingestion UI), Plan 05 (review UI), Plan 06 (ask/search UI),
Plan 08 (privacy/export UI).

## Scope

**In:** Tauri shell, app routing/state, design system baseline, empty and loaded states,
core views connected to local DB reads.

**Out:** extraction logic, model calls, production packaging, generic table editor.

## Key Decisions

- The first target is macOS desktop.
- The app uses React + TypeScript in a Tauri WebView.
- The default product surface is not a database browser.
- UI routes:
  - Today
  - Inbox
  - Ask/Search
  - Entities
  - Settings
- Keep the design quiet, operational, keyboard-friendly, and consistent with Reflect
  Open's local-first feel.

## Implementation Steps

1. Create the Tauri desktop app shell and register basic Rust commands for app status
   and DB availability.
2. Add a small design system foundation: typography, colors, spacing, buttons, inputs,
   dialogs, menus, and tooltips.
3. Add app-level navigation for Today, Inbox, Ask/Search, Entities, and Settings.
4. Implement Today with read-only sections for due tasks, upcoming events, recent
   memories, and open inbox items.
5. Implement Inbox with list/detail states for review items.
6. Implement Ask/Search as a query input and placeholder results surface.
7. Implement Entities as list/detail pages with related memories, tasks, events, and
   relationships.
8. Add first-run empty states that explain the source-to-memory loop without marketing
   page styling.

## Acceptance Criteria

- The Tauri app launches locally.
- The app can open or create the local SQLite brain.
- Navigation works from keyboard and mouse.
- Empty states guide the user to add a source.
- The UI reads real DB rows where available and handles an empty database gracefully.
- No route exposes a raw table editor as the main product path.

## Tests or Verification

- Run `pnpm check`.
- Run desktop UI tests for route rendering and empty states.
- Run a smoke test that opens the app with an empty DB.
- Manually verify text does not overflow at desktop and narrow widths.

## Open Questions

- Exact visual identity is unresolved. Default to a restrained Reflect-derived system
  until branding is chosen.
