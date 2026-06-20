# MVP Plan

The MVP should prove that an AI-operated local brain can maintain useful personal
context through a CLI/skill contract, with a desktop UI for browsing, correction, and
demonstration.

## Phase 1 - Repository and Shell

- Create the Tauri/React/Rust/pnpm/Turbo scaffold.
- Establish app layout, package boundaries, and quality commands.
- Open a local SQLite database from Rust.
- Let the user choose a brain folder and create `brain.sqlite` plus `assets/` inside it.
- Render the Picardo-inspired shell with Today, Tasks, Network, Projects, Ask, and
  Settings.

## Phase 2 - Durable Schema

- Add migrations for people, organizations, affiliations, projects, tasks,
  interactions, documents, assets, content chunks, memories, links, tags, and
  settings.
- Generate TypeScript database types.
- Add Rust-owned SQLite access and a typed IPC bridge.
- Add brain-root bootstrap and recent-folder reopen behavior.
- Add seed/demo data for local development.

## Phase 3 - Manual Capture

- Add paste/import flows that create documents or interactions directly.
- Support text, markdown, transcript text, and simple file import.
- Store readable text in SQLite.
- Store binary assets as app-managed files with SQLite metadata and links.
- Preserve original path, URL, and hash metadata when available.
- Create chunks for imported documents and interactions.

## Phase 4 - Extraction

- Extract candidate people, organizations, existing project links, tasks, and hidden
  atomic memories from documents and interactions.
- Link extracted records back to their evidence.
- Apply high-confidence changes directly.
- Let users correct extracted data from visible detail pages instead of forcing a
  review queue.

## Phase 5 - Core UI

- Today shows an AI daily brief with due tasks, scheduled items, waiting items,
  recent interactions, relationship-linked context, and active project changes.
- Tasks supports filtering, sorting, editing, and linked evidence.
- Network supports Graph, People, and Organizations tabs plus detail pages, with Graph
  as the default tab.
- Projects supports a list and detail pages with tasks, people, organizations,
  interactions, and documents.
- Ask supports grounded chat over local documents and interactions, with durable
  conversations and messages in SQLite.
- The Network Graph tab shows a user-centered node map derived from typed records and
  links. Filters by node type, time, strength, and project are optional follow-up.
- Settings owns about, brain identity, AI providers, and semantic search.
- The UI is optimized for quick browsing and inspection, not bulk data entry.

## Phase 6 - Agent Interface

- Ship a `brain` CLI for local agents.
- Support adding documents, interactions, assets, tasks, and memories.
- Support search, Today, and record lookup commands.
- Support daily report and todo-list generation for Codex automations.
- Install a local Codex skill that teaches agents how to use the CLI safely.

## Phase 7 - Packaging

- Package the macOS desktop app.
- Bundle or install the CLI.
- Add first-run setup and diagnostics.
- Document local storage behavior.

## Launch Criteria

- A user can add a meeting transcript, email body, note, or reference document.
- The app extracts useful tasks, people, organizations, existing project links, and
  memories.
- The user can browse by Today, Tasks, Network, Projects, and Ask.
- The user can inspect a graph view centered on themselves.
- The user can relaunch into the most recent brain folder.
- A local agent can add and query context through the CLI.
- A Codex daily automation can update the brain and generate a daily report/todo list.
- The daily report includes tasks, recent interactions, active projects, and cited
  relationship context where relevant.
- Settings shows about, the active brain identity, AI providers, and semantic search.
