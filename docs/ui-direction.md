# UI Direction

Local Brain should borrow the calm, dense, data-first feel of the Picardo internal UI,
but translate it into a personal context app. The UI is a window into a brain mostly
written and read by AI agents through the CLI and local skills.

The UI should support quick browsing, correction, inspection, and demonstration. It is
not the primary bulk-entry or reporting interface.

Use [Design System](design-system.md) for concrete component, token, typography, graph,
and shadcn guidance.

## Navigation

Sidebar:

```text
+------------------------------------------------------+
| Local Brain                                      Ask  |
+----------------------+-------------------------------+
| Today                |                               |
| Tasks                |  Current view                 |
| Network              |                               |
| Projects             |                               |
| Graph                |                               |
| Ask                  |                               |
| Settings             |                               |
+----------------------+-------------------------------+
```

Top-level sections:

- **Today:** AI daily brief with agenda, due tasks, waiting items, relationship
  follow-ups, recent changes, and suggested next actions.
- **Tasks:** all open, waiting, scheduled, and completed tasks.
- **Network:** people and organizations, with tabs for each.
- **Projects:** active, waiting, paused, done, and archived projects.
- **Graph:** node graph of the user's brain, centered on the user.
- **Ask:** AI chat over the local brain with citations.
- **Settings:** model keys, local storage, backup/export, diagnostics, and skill setup.

Document and interaction records are browsed inside Network, Project, and Task detail
pages, and found through global search or Ask.

## Information Architecture

```text
Today
  - AI daily brief
  - due and scheduled tasks
  - waiting items
  - people to follow up with
  - recent interactions
  - active project changes

Tasks
  - task table
  - task detail
    - linked people
    - linked organizations
    - linked projects
    - related documents
    - related interactions
    - evidence

Network
  - People tab
    - people table
    - person detail
      - profile and affiliations
      - tasks
      - projects
      - interactions
      - documents
      - remembered facts
  - Organizations tab
    - organizations table
    - organization detail
      - profile and people
      - projects
      - tasks
      - interactions
      - documents

Projects
  - project table/board
  - project detail
    - overview
    - tasks
    - people and organizations
    - interactions
    - documents
    - remembered decisions and risks

Graph
  - user-centered graph
  - people, organizations, projects, tasks, documents, interactions, and memories
  - optional filters by node type, time, strength, and project
  - click a node to open the related detail page

Ask
  - chat
  - citations
  - linked records

Settings
  - model keys
  - local database path
  - backup and export
  - diagnostics
  - agent skill setup
```

## Visual Style

- Left sidebar with compact navigation and a clear active state.
- Main surfaces should favor tables, split panes, detail drawers, filters, and search.
- Use cards only for repeated summary items or modals, not as the default page layout.
- Keep density high enough for real work.
- Use restrained color, crisp typography, and predictable spacing.
- Prefer visible data over explanatory copy.
- Make it obvious what changed recently and which records support an AI-generated
  report or todo list.

## Core Screens

### Today

```text
+----------------------+----------------------------------------------+
| Today                | Today                                        |
| Tasks                | Search...                              Ask   |
| Network              +----------------------------------------------+
| Projects             | Brief                                       |
| Graph                |  [ ] Send proposal follow-up     Project A  |
| Ask                  |  [ ] Book dentist appointment    Personal   |
| Settings             |                                              |
|                      | Relationships                               |
|                      |  Maya - follow up on contract comments      |
|                      |  Jordan - no interaction in 21 days         |
|                      |                                              |
|                      | Waiting                                      |
|                      |  Waiting on Maya - contract comments         |
|                      |                                              |
|                      | Recent interactions                          |
|                      |  9:30 AM  Call with Jordan                   |
|                      |  Yesterday Email from Acme                   |
+----------------------+----------------------------------------------+
```

### Network

```text
+----------------------+----------------------------------------------+
| Today                | Network                                      |
| Tasks                | [People] [Organizations]          Search... |
| Network              +----------------------+-----------------------+
| Projects             | Name                 | Profile               |
| Ask                  | Maya Chen            | Maya Chen             |
| Settings             | Jordan Lee           | Product lead at Acme  |
|                      | Acme Corp            |                       |
|                      |                      | Tasks                 |
|                      |                      | Interactions          |
|                      |                      | Documents             |
+----------------------+----------------------------------------------+
```

### Project Detail

```text
+----------------------+----------------------------------------------+
| Today                | Project: Home renovation                     |
| Tasks                | Status: active                 Ask about it |
| Network              +----------------------------------------------+
| Projects             | Tasks | People | Interactions | Documents    |
| Ask                  +----------------------------------------------+
| Settings             | [ ] Confirm contractor schedule              |
|                      | [ ] Choose bathroom tile                     |
|                      |                                              |
|                      | Recent interaction                           |
|                      | Call with Alex - budget changed              |
+----------------------+----------------------------------------------+
```

### Ask

```text
+----------------------+----------------------------------------------+
| Today                | Ask                                          |
| Tasks                |                                              |
| Network              | What did I promise Maya last week?           |
| Projects             |                                              |
| Ask                  | You promised to send the revised budget and  |
| Settings             | introduce her to Jordan.                     |
|                      |                                              |
|                      | Citations                                    |
|                      | - Call with Maya, Jun 10                     |
|                      | - Email to Maya, Jun 11                      |
+----------------------+----------------------------------------------+
```

### Graph

```text
+----------------------+----------------------------------------------+
| Today                | Graph                         Filter: All   |
| Tasks                |                                              |
| Network              |                 [Alex]                       |
| Projects             |              /    |    \\                    |
| Graph                |        Maya       Home Reno       Acme        |
| Ask                  |       /   \\          |          /  \\       |
| Settings             | Budget  Call   Tile task   Jordan  Contract  |
|                      |                                              |
|                      | Selected: Home Reno                          |
|                      | Tasks | People | Interactions | Documents    |
+----------------------+----------------------------------------------+
```

## Interaction Rules

- Search should be global and available from all main surfaces.
- Ask should cite documents or interactions directly.
- A user should be able to correct a task, person link, project link, or remembered
  fact from the detail page where it appears.
- Graph should be a derived navigation and demonstration surface, not the storage
  model.
- Imported text should become a document or interaction immediately.
- No mandatory review queue for extracted data.
