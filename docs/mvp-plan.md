# MVP Plan

The MVP should prove that an AI-operated local brain can maintain useful personal
context through a CLI/skill contract, with a desktop UI for browsing, correction, and
demonstration.

## Phase 1 - Repository and Shell

- Create the Tauri/React/Rust/pnpm/Turbo scaffold.
- Establish app layout, package boundaries, and quality commands.
- Open a local SQLite database from Rust.
- Render the Picardo-inspired shell with Today, Tasks, Network, Projects, Graph, Ask, and
  Settings.

## Phase 2 - Durable Schema

- Add migrations for people, organizations, affiliations, projects, tasks,
  interactions, documents, content chunks, memories, links, tags, chat, and settings.
- Generate TypeScript database types.
- Add Rust-owned SQLite access and a typed IPC bridge.
- Add seed/demo data for local development.

## Phase 3 - Manual Capture

- Add paste/import flows that create documents or interactions directly.
- Support text, markdown, transcript text, and simple file import.
- Store readable text in SQLite.
- Preserve original path, URL, and hash metadata when available.
- Create chunks for imported documents and interactions.

## Phase 4 - Extraction

- Extract candidate people, organizations, projects, tasks, and hidden atomic memories
  from documents and interactions.
- Link extracted records back to their evidence.
- Apply high-confidence changes directly.
- Let users correct extracted data from visible detail pages instead of forcing a
  review queue.

## Phase 5 - Core UI

- Today shows an AI daily brief with due tasks, scheduled items, waiting items,
  relationship follow-ups, recent interactions, and active project changes.
- Tasks supports filtering, sorting, editing, and linked evidence.
- Network supports People and Organizations tabs plus detail pages.
- Projects supports a list and detail pages with tasks, people, organizations,
  interactions, and documents.
- Graph shows a user-centered node map derived from typed records and links. Filters by
  node type, time, strength, and project are optional follow-up.
- Ask supports cited answers over the local brain.
- Settings owns model keys, backup/export, diagnostics, and skill setup.
- The UI is optimized for quick browsing and inspection, not bulk data entry.

## Phase 6 - Agent Interface

- Ship a `brain` CLI for local agents.
- Support adding documents, interactions, tasks, and memories.
- Support search, Ask, Today, and record lookup commands.
- Support daily report and todo-list generation for Codex automations.
- Install a local Codex skill that teaches agents how to use the CLI safely.

## Phase 7 - Packaging

- Package the macOS desktop app.
- Bundle or install the CLI.
- Add first-run setup and diagnostics.
- Document backup/export and local storage behavior.

## Launch Criteria

- A user can add a meeting transcript, email body, note, or reference document.
- The app extracts useful tasks, people, organizations, projects, and memories.
- The user can browse by Today, Tasks, Network, and Projects.
- The user can inspect a graph view centered on themselves.
- Ask answers questions with citations to documents or interactions.
- A local agent can add and query context through the CLI.
- A Codex daily automation can update the brain and generate a daily report/todo list.
- The daily report includes relationship follow-ups and stale relationships.
- Backup/export is discoverable in Settings.
