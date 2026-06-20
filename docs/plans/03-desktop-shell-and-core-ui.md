# Plan 03 - Desktop Shell and Core UI

**Goal:** Build the first usable desktop shell and core personal-CRM surfaces.

**Depends on:** Plans 01-02.

**Unlocks:** Plans 04-08.

## Scope

**In:** Tauri app shell, React routes, sidebar, global search entry, Today, Tasks,
Network (including Graph), Projects, Ask, Settings, first-run brain folder chooser,
shared UI primitives, basic record detail pages.

**Out:** full extraction, advanced retrieval, packaging.

## Key Decisions

- The UI takes inspiration from the Picardo internal app: compact sidebar, dense
  tables, split panes, clear detail pages, and little marketing chrome.
- The UI is secondary to the CLI/skill operating path. Optimize it for browsing,
  correction, inspection, and demo.
- Shared UI should use shadcn components themed through `globals.css`, following
  [Design System](../design-system.md).
- Sidebar sections are Today, Tasks, Network, Projects, Ask, and Settings.
- Network has Graph, People, and Organizations tabs, with Graph as the default.
- Documents and interactions are browsed inside related detail pages and through search or Ask.
- Settings owns about, brain identity, AI providers, and semantic search.
- Startup follows Reflect Open's graph chooser: choose/open a brain folder, show recents,
  auto-open the newest recent folder on launch, and surface open failures back on the
  chooser.
- Graph is a Picardo-inspired node graph with the user at the center.
- Use a typed route model and central command/keymap registry, following Reflect Open's
  routing and shortcut pattern.
- No top-level automation log surface.

## Implementation Steps

1. Create the Tauri window and React router.
2. Build the brain chooser/loading gate:
   - OS folder picker for a brain directory
   - recent brain list with open and forget actions
   - loading, choosing, opening, ready, and error states
   - auto-open newest recent brain on launch
   - display cloud-folder warnings when the selected root is inside iCloud/Dropbox/Drive
3. Build app layout:
   - fixed sidebar
   - top search/command field
   - main content region
   - optional right-side detail pane
4. Define typed routes:
   - `{ kind: 'today' }`
   - `{ kind: 'tasks' }`
   - `{ kind: 'network'; tab: 'graph' | 'people' | 'organizations' }`
   - `{ kind: 'person'; id: string }`
   - `{ kind: 'organization'; id: string }`
   - `{ kind: 'projects' }`
   - `{ kind: 'project'; id: string }`
   - `{ kind: 'task'; id: string }`
   - `{ kind: 'document'; id: string }`
   - `{ kind: 'interaction'; id: string }`
   - `{ kind: 'settings'; section?: string }`
5. Add URL mappings:
   - `/today`
   - `/tasks`
   - `/network?tab=graph`
   - `/network?tab=people`
   - `/network?tab=organizations`
   - `/projects`
   - `/settings`
6. Add route history:
   - back/forward
   - focus restore
   - selected row/detail restore
   - deep-link-safe record ids
7. Add a central command/keymap registry:
   - go to Today
   - open command palette
   - back/forward
   - new document
   - new interaction
   - new task
   - run daily report
   - open Graph
8. Add detail routes or drawers for:
   - person
   - organization
   - project
   - task
   - document
   - interaction
9. Build shared components:
   - sidebar item
   - table/list view
   - filters
   - empty state
   - detail header
   - linked-record section
   - citation list
   - settings section
10. Add shadcn components needed for the MVP and theme them through `globals.css`.
11. Build Today from real queries:
   - AI daily brief
   - due tasks
   - scheduled tasks
   - waiting items
   - recent interactions
   - relationship-linked context
   - active project updates
12. Build Tasks with status filters and inline completion.
13. Build Network tables and detail pages.
14. Build Projects table/detail pages.
15. Build the Network Graph tab from typed records and links:
    - center on the user's own person row
    - show people, organizations, projects, tasks, documents, interactions, and memories
    - open related detail pages from nodes
16. Build Settings sections for about, brain identity, AI providers, and semantic search.

## Acceptance Criteria

- The app opens to Today.
- A first-run user can choose a brain folder; a returning user auto-opens the newest
  recent brain or sees the chooser with recoverable errors.
- Today reads like a generated operating brief, not just a task list.
- Sidebar matches [UI Direction](../ui-direction.md).
- Graph renders a user-centered node map from seed data.
- Document and interaction records are reachable from detail pages and search.
- A user can create/edit people, organizations, projects, and tasks.
- A user can quickly inspect what an automation changed or cited.
- Detail pages show linked tasks, documents, interactions, and memories where relevant.
- People and organization detail pages can show linked avatar and logo assets.
- Back/forward and command-palette navigation use the typed route model.
- Global keyboard shortcuts are registered once and covered by duplicate-binding tests.

## Tests or Verification

- Run component tests for route rendering.
- Run IPC-backed smoke tests against seed data.
- Verify desktop and narrow window layouts do not overlap.
- Verify keyboard navigation for sidebar, search, and main tables.
- Test route serialization/deserialization and history restoration.

## Open Questions

- Exact global search keyboard shortcut can be chosen during implementation.
- Graph filters by node type, time range, project, and relationship strength are useful
  follow-up once the base graph is working.
